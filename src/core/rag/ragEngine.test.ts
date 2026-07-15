import { VectorManager } from '../../database/modules/vector/VectorManager'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { ChatModel } from '../../types/chat-model.types'
import {
  ContextualEmbeddingInputType,
  ContextualEmbeddingsResult,
} from '../../types/embedding'
import {
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { BaseLLMProvider } from '../llm/base'
import { getProviderClient } from '../llm/manager'

import { RAGEngine } from './ragEngine'

jest.mock('../llm/manager', () => ({
  getProviderClient: jest.fn(),
}))

const getProviderClientMock = jest.mocked(getProviderClient)

describe('RAGEngine contextual embedding routing', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('uses contextual query embeddings for voyage-context-4', async () => {
    const contextualEmbedding = jest.fn().mockResolvedValue({
      chunks: [{ embedding: [0.1, 0.2], text: 'query' }],
    })
    getProviderClientMock.mockReturnValue(
      createProviderClient({
        getContextualEmbeddings: contextualEmbedding,
      }),
    )
    const performSimilaritySearch = jest.fn().mockResolvedValue([])
    const vectorManager = createVectorManager({ performSimilaritySearch })
    const engine = new RAGEngine(
      createSettings({
        embeddingModelId: 'voyage/voyage-context-4',
        embeddingModels: [
          {
            providerType: 'voyage',
            providerId: 'voyage',
            id: 'voyage/voyage-context-4',
            model: 'voyage-context-4',
            dimension: 1024,
          },
        ],
      }),
      vectorManager,
    )

    await engine.processQuery({ query: 'find context' })

    expect(contextualEmbedding).toHaveBeenCalledWith(
      'voyage-context-4',
      'find context',
      {
        dimensions: undefined,
        inputType: 'query',
        signal: expect.anything(),
      },
    )
    expect(performSimilaritySearch).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        id: 'voyage/voyage-context-4',
      }),
      expect.any(Object),
    )
  })

  it('keeps standard embedding models on getEmbedding', async () => {
    const getEmbedding = jest.fn().mockResolvedValue([0.3, 0.4])
    const contextualEmbedding = jest.fn()
    getProviderClientMock.mockReturnValue(
      createProviderClient({
        getEmbedding,
        getContextualEmbeddings: contextualEmbedding,
      }),
    )
    const performSimilaritySearch = jest.fn().mockResolvedValue([])
    const updateVaultIndex = jest.fn().mockResolvedValue(undefined)
    const vectorManager = createVectorManager({
      performSimilaritySearch,
      updateVaultIndex,
    })
    const engine = new RAGEngine(
      createSettings({
        embeddingModelId: 'voyage/voyage-4',
        embeddingModels: [
          {
            providerType: 'voyage',
            providerId: 'voyage',
            id: 'voyage/voyage-4',
            model: 'voyage-4',
            dimension: 1024,
          },
        ],
      }),
      vectorManager,
    )

    const scope = { files: ['picked.md'], folders: ['notes'] }
    await engine.processQuery({ query: 'standard query', scope })

    expect(getEmbedding).toHaveBeenCalledWith('voyage-4', 'standard query', {
      dimensions: undefined,
      signal: expect.anything(),
    })
    expect(contextualEmbedding).not.toHaveBeenCalled()
    expect(performSimilaritySearch).toHaveBeenCalledWith(
      [0.3, 0.4],
      expect.objectContaining({
        id: 'voyage/voyage-4',
      }),
      expect.objectContaining({ scope }),
    )
    expect(updateVaultIndex).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ scope }),
      expect.any(Function),
    )
  })

  it('does not publish similarity results after the query is aborted', async () => {
    getProviderClientMock.mockReturnValue(
      createProviderClient({
        getEmbedding: jest.fn().mockResolvedValue([0.3, 0.4]),
      }),
    )
    let finishSearch: ((value: []) => void) | undefined
    let markSearchStarted: (() => void) | undefined
    const searchStarted = new Promise<void>((resolve) => {
      markSearchStarted = resolve
    })
    const performSimilaritySearch = jest.fn(
      () =>
        new Promise<[]>((resolve) => {
          finishSearch = resolve
          markSearchStarted?.()
        }),
    )
    const engine = new RAGEngine(
      createSettings({
        embeddingModelId: 'voyage/voyage-4',
        embeddingModels: [
          {
            providerType: 'voyage',
            providerId: 'voyage',
            id: 'voyage/voyage-4',
            model: 'voyage-4',
            dimension: 1024,
          },
        ],
      }),
      createVectorManager({ performSimilaritySearch }),
    )
    const controller = new AbortController()
    const onProgress = jest.fn()

    const query = engine.processQuery({
      query: 'cancelled search',
      signal: controller.signal,
      onQueryProgressChange: onProgress,
    })
    await searchStarted
    controller.abort()
    finishSearch?.([])

    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
    expect(onProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'querying-done' }),
    )
  })

  it('serializes concurrent index updates', async () => {
    getProviderClientMock.mockReturnValue(createProviderClient({}))
    let activeUpdates = 0
    let maxActiveUpdates = 0
    const updateVaultIndex = jest.fn(async () => {
      activeUpdates += 1
      maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates)
      await Promise.resolve()
      activeUpdates -= 1
    })
    const engine = new RAGEngine(
      createSettings({
        embeddingModelId: 'voyage/voyage-4',
        embeddingModels: [
          {
            providerType: 'voyage',
            providerId: 'voyage',
            id: 'voyage/voyage-4',
            model: 'voyage-4',
            dimension: 1024,
          },
        ],
      }),
      {
        updateVaultIndex,
      } as unknown as VectorManager,
    )

    await Promise.all([
      engine.updateVaultIndex(),
      engine.updateVaultIndex(),
      engine.updateVaultIndex(),
    ])

    expect(updateVaultIndex).toHaveBeenCalledTimes(3)
    expect(maxActiveUpdates).toBe(1)
  })

  it('keeps one model snapshot across settings changes', async () => {
    const getEmbedding = jest.fn().mockResolvedValue([0.3, 0.4])
    getProviderClientMock.mockReturnValue(
      createProviderClient({ getEmbedding }),
    )
    let finishIndex: (() => void) | undefined
    const updateVaultIndex = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishIndex = resolve
        }),
    )
    const performSimilaritySearch = jest.fn().mockResolvedValue([])
    const vectorManager = {
      updateVaultIndex,
      performSimilaritySearch,
    } as unknown as VectorManager
    const initialSettings = createSettings({
      embeddingModelId: 'voyage/voyage-4',
      embeddingModels: [
        {
          providerType: 'voyage',
          providerId: 'voyage',
          id: 'voyage/voyage-4',
          model: 'voyage-4',
          dimension: 1024,
        },
      ],
    })
    const engine = new RAGEngine(initialSettings, vectorManager)

    const query = engine.processQuery({ query: 'stable model' })
    await Promise.resolve()
    await Promise.resolve()
    engine.setSettings({
      ...initialSettings,
      embeddingModelId: 'voyage/voyage-4-lite',
      embeddingModels: [
        {
          providerType: 'voyage',
          providerId: 'voyage',
          id: 'voyage/voyage-4-lite',
          model: 'voyage-4-lite',
          dimension: 512,
        },
      ],
    })
    finishIndex?.()
    await query

    expect(getEmbedding).toHaveBeenCalledWith('voyage-4', 'stable model', {
      dimensions: undefined,
      signal: expect.anything(),
    })
    expect(performSimilaritySearch).toHaveBeenCalledWith(
      [0.3, 0.4],
      expect.objectContaining({ id: 'voyage/voyage-4' }),
      expect.any(Object),
    )
    await engine.cleanup()
    await expect(engine.updateVaultIndex()).rejects.toThrow(
      'RAG engine is closed',
    )
  })

  it('aborts an active index request before cleanup waits for it', async () => {
    getProviderClientMock.mockReturnValue(createProviderClient({}))
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let receivedSignal: AbortSignal | undefined
    const updateVaultIndex = jest.fn(
      (_model, options: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          receivedSignal = options.signal
          markStarted?.()
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Operation aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const engine = new RAGEngine(
      createSettings({
        embeddingModelId: 'voyage/voyage-4',
        embeddingModels: [
          {
            providerType: 'voyage',
            providerId: 'voyage',
            id: 'voyage/voyage-4',
            model: 'voyage-4',
            dimension: 1024,
          },
        ],
      }),
      { updateVaultIndex } as unknown as VectorManager,
    )

    const update = engine.updateVaultIndex()
    const observedUpdate = update.catch((error: unknown) => error)
    await started
    await engine.cleanup()

    expect(receivedSignal?.aborted).toBe(true)
    await expect(observedUpdate).resolves.toMatchObject({ name: 'AbortError' })
  })
})

function createProviderClient({
  getEmbedding = jest.fn(),
  getContextualEmbeddings = jest.fn(),
}: {
  getEmbedding?: EmbeddingMock
  getContextualEmbeddings?: ContextualEmbeddingMock
}) {
  return new FakeProvider(getEmbedding, getContextualEmbeddings)
}

type EmbeddingMock = jest.MockedFunction<
  (
    model: string,
    text: string,
    options?: { dimensions?: number },
  ) => Promise<number[]>
>

type ContextualEmbeddingMock = jest.MockedFunction<
  (
    model: string,
    text: string,
    options: {
      inputType: ContextualEmbeddingInputType
      dimensions?: number
    },
  ) => Promise<ContextualEmbeddingsResult>
>

class FakeProvider extends BaseLLMProvider<LLMProvider> {
  constructor(
    private readonly getEmbeddingMock: EmbeddingMock,
    readonly getContextualEmbeddings: ContextualEmbeddingMock,
  ) {
    super({ type: 'voyage', id: 'voyage' })
  }

  async generateResponse(
    _model: ChatModel,
    _request: LLMRequestNonStreaming,
  ): Promise<LLMResponseNonStreaming> {
    throw new Error('not used')
  }

  async streamResponse(
    _model: ChatModel,
    _request: LLMRequestStreaming,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    throw new Error('not used')
  }

  async getEmbedding(
    model: string,
    text: string,
    options?: { dimensions?: number },
  ): Promise<number[]> {
    return this.getEmbeddingMock(model, text, options)
  }
}

function createVectorManager({
  performSimilaritySearch,
  updateVaultIndex = jest.fn().mockResolvedValue(undefined),
}: {
  performSimilaritySearch: jest.Mock
  updateVaultIndex?: jest.Mock
}): VectorManager {
  return {
    updateVaultIndex,
    performSimilaritySearch,
  } as unknown as VectorManager
}

function createSettings(
  overrides: Partial<SmartComposerSettings>,
): SmartComposerSettings {
  return {
    version: 20,
    providers: [{ type: 'voyage', id: 'voyage' }],
    chatModels: [],
    embeddingModels: [],
    chatModelId: 'chat-model',
    applyModelId: 'chat-model',
    embeddingModelId: 'embedding',
    systemPrompt: '',
    ragOptions: {
      chunkSize: 1000,
      thresholdTokens: 8192,
      minSimilarity: 0,
      limit: 10,
      excludePatterns: [],
      includePatterns: [],
    },
    mcp: {
      servers: [],
    },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
    agent: {
      codex: {
        enabled: true,
        command: 'codex',
        defaultSandbox: 'workspace-write',
        approvalPolicy: 'never',
        cwdMode: 'vault',
        customCwd: '',
        resume: true,
      },
    },
    ...overrides,
  }
}
