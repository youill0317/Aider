import { SerializedEditorState } from 'lexical'
import { App, TFile } from 'obsidian'

import { RAGEngine } from '../../core/rag/ragEngine'
import { SelectEmbedding } from '../../database/schema'
import { VectorMetaData } from '../../database/vector-metadata'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { ChatUserMessage } from '../../types/chat'
import { ContentPart } from '../../types/llm/request'

import { PromptGenerator } from './promptGenerator'

type SimilarityResult = Omit<SelectEmbedding, 'embedding'> & {
  similarity: number
}

describe('PromptGenerator RAG metadata handling', () => {
  it('omits line numbers when compiling file-only contextual snippets', async () => {
    const promptGenerator = createPromptGenerator([
      createSimilarityResult({
        content: 'Server selected context',
        metadata: {
          linkMode: 'file-only',
          source: 'voyage-auto-chunk',
          chunkSizeMode: 'server-default',
          indexProfile:
            'route=voyage-contextual-auto-chunk;model=voyage/voyage-context-4;dimension=1024;autoChunking=true;chunkSizeMode=server-default',
        },
      }),
    ])

    const compiled = await promptGenerator.compileUserMessagePrompt({
      message: createVaultSearchUserMessage(),
      useVaultSearch: true,
    })

    const text = getTextContent(compiled.promptContent)
    expect(text).toContain('Server selected context')
    expect(text).not.toContain('1|Server selected context')
    expect(text).not.toContain('startLine')
    expect(text).not.toContain('endLine')
  })

  it('keeps line numbers when compiling line-linked RAG snippets', async () => {
    const promptGenerator = createPromptGenerator([
      createSimilarityResult({
        content: 'Line linked context',
        metadata: {
          startLine: 27,
          endLine: 27,
        },
      }),
    ])

    const compiled = await promptGenerator.compileUserMessagePrompt({
      message: createVaultSearchUserMessage(),
      useVaultSearch: true,
    })

    expect(getTextContent(compiled.promptContent)).toContain(
      '27|Line linked context',
    )
  })

  it('does not emit exact line source instructions for file-only RAG snippets', async () => {
    const promptGenerator = createPromptGenerator()
    const requestMessages = await promptGenerator.generateRequestMessages({
      messages: [
        createCompiledUserMessage([
          createSimilarityResult({
            metadata: {
              linkMode: 'file-only',
              source: 'voyage-auto-chunk',
              chunkSizeMode: 'server-default',
              indexProfile:
                'route=voyage-contextual-auto-chunk;model=voyage/voyage-context-4;dimension=1024;autoChunking=true;chunkSizeMode=server-default',
            },
          }),
        ]),
      ],
    })

    const instructionText = requestMessages
      .map((message) =>
        typeof message.content === 'string' ? message.content : '',
      )
      .join('\n')

    expect(instructionText).toContain('file-only')
    expect(instructionText).not.toContain('startLine="200"')
    expect(instructionText).not.toContain(
      'add the startLine and endLine attributes',
    )
  })

  it('does not read mentioned files before an explicit vault search', async () => {
    const cachedRead = jest.fn()
    const ragEngine = {
      processQuery: jest.fn().mockResolvedValue([]),
    } as unknown as RAGEngine
    const promptGenerator = new PromptGenerator(
      async () => ragEngine,
      { vault: { cachedRead } } as unknown as App,
      createSettings({}),
    )
    const message = createVaultSearchUserMessage()
    message.mentionables.push({
      type: 'file',
      file: { path: 'large.md' } as TFile,
    })

    await promptGenerator.compileUserMessagePrompt({
      message,
      useVaultSearch: true,
    })

    expect(cachedRead).not.toHaveBeenCalled()
  })

  it('uses file size to avoid reading mentioned files that already exceed the RAG threshold', async () => {
    const cachedRead = jest.fn()
    const processQuery = jest.fn().mockResolvedValue([])
    const promptGenerator = new PromptGenerator(
      async () => ({ processQuery }) as unknown as RAGEngine,
      { vault: { cachedRead } } as unknown as App,
      createSettings({
        ragOptions: {
          chunkSize: 1000,
          thresholdTokens: 100,
          minSimilarity: 0,
          limit: 10,
          excludePatterns: [],
          includePatterns: [],
        },
      }),
    )
    const message = createVaultSearchUserMessage()
    message.mentionables = [
      {
        type: 'file',
        file: {
          path: 'large.md',
          stat: { size: 1_000 },
        } as TFile,
      },
    ]

    await promptGenerator.compileUserMessagePrompt({ message })

    expect(cachedRead).not.toHaveBeenCalled()
    expect(processQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { files: ['large.md'], folders: [] },
      }),
    )
  })

  it('retrieves snippets for an oversized current file', async () => {
    const processQuery = jest.fn().mockResolvedValue([
      createSimilarityResult({
        content: 'Relevant current-file snippet',
        metadata: { startLine: 1, endLine: 1 },
      }),
    ])
    const promptGenerator = new PromptGenerator(
      async () => ({ processQuery }) as unknown as RAGEngine,
      { vault: { cachedRead: jest.fn() } } as unknown as App,
      createSettings({}),
    )
    const message: ChatUserMessage = {
      role: 'user',
      id: 'user-current-file',
      content: createEditorState('Summarize the current note.'),
      promptContent: null,
      mentionables: [
        {
          type: 'current-file',
          file: {
            path: 'large.md',
            stat: { size: 512 * 1024 + 1 },
          } as TFile,
        },
      ],
    }

    const requestMessages = await promptGenerator.generateRequestMessages({
      messages: [message],
    })
    const prompt = requestMessages
      .map(({ content }) => getTextContent(content))
      .join('\n')

    expect(processQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { files: ['large.md'], folders: [] },
      }),
    )
    expect(prompt).toContain('Relevant current-file snippet')
    expect(prompt).not.toContain('too large to include directly')
  })

  it('preserves attachments from older uncompiled user turns', async () => {
    const processQuery = jest.fn().mockResolvedValue([])
    const promptGenerator = new PromptGenerator(
      async () => ({ processQuery }) as unknown as RAGEngine,
      { vault: {} } as App,
      createSettings({}),
    )
    const olderMessage = {
      ...createVaultSearchUserMessage(),
      id: 'older-user',
      content: createEditorState('  Older question  '),
      mentionables: [
        {
          type: 'image' as const,
          name: 'older.png',
          mimeType: 'image/png',
          data: 'data:image/png;base64,older',
        },
      ],
    }
    const latestMessage = {
      ...createVaultSearchUserMessage(),
      id: 'latest-user',
      content: createEditorState('Latest question'),
      mentionables: [],
    }
    const compilePrompt = jest.spyOn(
      promptGenerator,
      'compileUserMessagePrompt',
    )

    const requestMessages = await promptGenerator.generateRequestMessages({
      messages: [olderMessage, latestMessage],
    })

    expect(compilePrompt).toHaveBeenCalledTimes(2)
    expect(compilePrompt).toHaveBeenNthCalledWith(1, { message: olderMessage })
    expect(compilePrompt).toHaveBeenNthCalledWith(2, { message: latestMessage })
    expect(processQuery).not.toHaveBeenCalled()
    const userMessages = requestMessages.filter(
      (message) => message.role === 'user',
    )
    expect(userMessages[0]?.content).toEqual(
      expect.arrayContaining([
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,older' },
        },
      ]),
    )
    expect(getTextContent(userMessages[1]?.content ?? null)).toContain(
      'Latest question',
    )
  })

  it('passes prompt cancellation to vault search', async () => {
    const processQuery = jest.fn().mockResolvedValue([])
    const promptGenerator = new PromptGenerator(
      async () => ({ processQuery }) as unknown as RAGEngine,
      { vault: {} } as App,
      createSettings({}),
    )
    const abortController = new AbortController()

    await promptGenerator.compileUserMessagePrompt({
      message: createVaultSearchUserMessage(),
      useVaultSearch: true,
      signal: abortController.signal,
    })

    expect(processQuery).toHaveBeenCalledWith(
      expect.objectContaining({ signal: abortController.signal }),
    )
  })
})

function createPromptGenerator(
  similaritySearchResults: SimilarityResult[] = [],
): PromptGenerator {
  const ragEngine = {
    processQuery: jest.fn().mockResolvedValue(similaritySearchResults),
  } as unknown as RAGEngine

  return new PromptGenerator(
    async () => ragEngine,
    {
      vault: {},
    } as App,
    createSettings({}),
  )
}

function createSettings(
  overrides: Partial<SmartComposerSettings>,
): SmartComposerSettings {
  return {
    version: 20,
    providers: [],
    chatModels: [
      {
        id: 'chat-model',
        providerType: 'openai',
        providerId: 'provider',
        model: 'model',
      },
    ],
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

function createSimilarityResult({
  content = 'Contextual chunk',
  metadata,
}: {
  content?: string
  metadata: VectorMetaData
}): SimilarityResult {
  return {
    id: 1,
    path: 'notes/context.md',
    mtime: 100,
    content,
    model: 'voyage/voyage-context-4',
    dimension: 1024,
    metadata,
    similarity: 0.9,
  }
}

function createVaultSearchUserMessage(): ChatUserMessage {
  return {
    role: 'user',
    id: 'user-vault',
    content: createEditorState('What does my vault say?'),
    promptContent: null,
    mentionables: [
      {
        type: 'vault',
      },
    ],
  }
}

function createCompiledUserMessage(
  similaritySearchResults: SimilarityResult[],
): ChatUserMessage {
  return {
    role: 'user',
    id: 'user-compiled',
    content: null,
    promptContent: 'What does my vault say?',
    mentionables: [],
    similaritySearchResults,
  }
}

function createEditorState(text: string): SerializedEditorState {
  const editorState = {
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [
            {
              type: 'text',
              version: 1,
              text,
            },
          ],
        },
      ],
      direction: null,
      format: '',
      indent: 0,
    },
  }
  return editorState as unknown as SerializedEditorState
}

function getTextContent(promptContent: string | ContentPart[] | null): string {
  if (typeof promptContent === 'string') {
    return promptContent
  }
  return promptContent?.find((part) => part.type === 'text')?.text ?? ''
}
