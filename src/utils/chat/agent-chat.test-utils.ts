import { v4 as uuidv4 } from 'uuid'

import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import { ChatAssistantMessage, ChatToolMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { AGENT_CHAT_SUMMARY } from './agent-chat'

type BuildAgentChatToolMessageParams = {
  readonly conversationId: string
  readonly prompt: string
  readonly isExecutionAllowed: (params: {
    readonly requestToolName: string
    readonly requestArgs?: string
    readonly conversationId?: string
  }) => boolean
}

export function buildAgentChatToolMessage({
  conversationId,
  prompt,
  isExecutionAllowed,
}: BuildAgentChatToolMessageParams): ChatToolMessage {
  const requestArgs = JSON.stringify({
    prompt,
    summary: AGENT_CHAT_SUMMARY,
  })
  const request = {
    id: uuidv4(),
    name: CODEX_TOOL_NAME,
    arguments: requestArgs,
  }

  return {
    role: 'tool',
    id: uuidv4(),
    toolCalls: [
      {
        request,
        response: {
          status: isExecutionAllowed({
            requestToolName: request.name,
            requestArgs,
            conversationId,
          })
            ? ToolCallResponseStatus.Running
            : ToolCallResponseStatus.PendingApproval,
        },
      },
    ],
  }
}

export function buildAgentChatMessages(
  params: BuildAgentChatToolMessageParams,
): readonly [ChatAssistantMessage, ChatToolMessage] {
  const toolMessage = buildAgentChatToolMessage(params)
  return [
    {
      role: 'assistant',
      content: '',
      id: uuidv4(),
      toolCallRequests: toolMessage.toolCalls.map(
        (toolCall) => toolCall.request,
      ),
    },
    toolMessage,
  ]
}
