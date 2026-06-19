import { SerializedEditorState } from 'lexical'
import { App } from 'obsidian'

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
