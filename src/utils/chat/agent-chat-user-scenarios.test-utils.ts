import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ChatAgentCommandMessage,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { buildAgentChatMessages } from './agent-chat'
import { PromptGenerator } from './promptGenerator'

export async function createRequestMessages(messages: readonly ChatMessage[]) {
  const promptGenerator = new PromptGenerator(
    async () => {
      throw new Error('RAG engine is not used by these user journey tests.')
    },
    {} as never,
    createSettings(),
  )
  return promptGenerator.generateRequestMessages({ messages: [...messages] })
}

export function user(promptContent: string, id: string): ChatUserMessage {
  return {
    content: null,
    id,
    mentionables: [],
    promptContent,
    role: 'user',
  }
}

export function assistant(content: string, id: string): ChatAssistantMessage {
  return {
    content,
    id,
    role: 'assistant',
  }
}

export function agentCommand({
  command,
  id,
  output,
}: {
  readonly command: string
  readonly id: string
  readonly output: string
}): ChatAgentCommandMessage {
  return {
    detail: command,
    exitCode: 0,
    id: `agent-command-${id}`,
    input: '',
    kind: 'command',
    output,
    role: 'agent-command',
    status: 'success',
    title: '>_',
  }
}

export function completedAgentMessages(
  resultText: string,
  idSuffix = 'agent',
): readonly [ChatAssistantMessage, ChatToolMessage] {
  const [agentAssistantMessage, agentToolMessage] = buildAgentChatMessages({
    conversationId: 'conversation-1',
    isExecutionAllowed: () => true,
    prompt: `Inspect ${idSuffix}.`,
  })
  return [
    {
      ...agentAssistantMessage,
      id: `assistant-${idSuffix}`,
    },
    {
      ...agentToolMessage,
      id: `tool-${idSuffix}`,
      toolCalls: agentToolMessage.toolCalls.map((toolCall) => ({
        ...toolCall,
        response: {
          data: {
            text: resultText,
            type: 'text',
          },
          status: ToolCallResponseStatus.Success,
        },
      })),
    },
  ]
}

export function extractUserText(
  requestMessages: Awaited<ReturnType<typeof createRequestMessages>>,
): readonly string[] {
  return requestMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .filter((content): content is string => typeof content === 'string')
}

export function extractAssistantText(
  requestMessages: Awaited<ReturnType<typeof createRequestMessages>>,
): readonly string[] {
  return requestMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
}

export function getCodexAssistantIndex(
  requestMessages: Awaited<ReturnType<typeof createRequestMessages>>,
): number {
  return requestMessages.findIndex(
    (message) =>
      message.role === 'assistant' &&
      message.tool_calls?.[0]?.name === 'run_codex',
  )
}

export function getCodexToolIndex(
  requestMessages: Awaited<ReturnType<typeof createRequestMessages>>,
): number {
  return requestMessages.findIndex(
    (message) =>
      message.role === 'tool' && message.tool_call.name === 'run_codex',
  )
}

function createSettings(): SmartComposerSettings {
  return {
    agent: {
      codex: {
        approvalPolicy: 'default',
        command: 'codex',
        customCwd: '',
        cwdMode: 'vault',
        defaultSandbox: 'workspace-write',
        enabled: true,
        resume: true,
      },
    },
    applyModelId: 'chat-model',
    chatModelId: 'chat-model',
    chatModels: [
      {
        id: 'chat-model',
        model: 'model',
        providerId: 'provider',
        providerType: 'openai',
      },
    ],
    chatOptions: {
      enableTools: true,
      includeCurrentFileContent: true,
      maxAutoIterations: 1,
    },
    embeddingModelId: 'embedding',
    embeddingModels: [],
    mcp: {
      servers: [],
    },
    providers: [],
    ragOptions: {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
      limit: 10,
      minSimilarity: 0,
      thresholdTokens: 8192,
    },
    systemPrompt: '',
    version: 17,
  }
}
