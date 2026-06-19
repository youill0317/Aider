import { App } from 'obsidian'

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
      {} as App,
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
    const vectorManager = createVectorManager({ performSimilaritySearch })
    const engine = new RAGEngine(
      {} as App,
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

    await engine.processQuery({ query: 'standard query' })

    expect(getEmbedding).toHaveBeenCalledWith('voyage-4', 'standard query', {
      dimensions: undefined,
    })
    expect(contextualEmbedding).not.toHaveBeenCalled()
    expect(performSimilaritySearch).toHaveBeenCalledWith(
      [0.3, 0.4],
      expect.objectContaining({
        id: 'voyage/voyage-4',
      }),
      expect.any(Object),
    )
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
}: {
  performSimilaritySearch: jest.Mock
}): VectorManager {
  return {
    updateVaultIndex: jest.fn().mockResolvedValue(undefined),
    performSimilaritySearch,
  } as unknown as VectorManager
}

function createSettings(
  overrides: Partial<SmartComposerSettings>,
): SmartComposerSettings {
  return {
    version: 20,
    providers: [],
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
