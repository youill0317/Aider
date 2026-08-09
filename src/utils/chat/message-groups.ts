import {
  AssistantToolMessageGroup,
  ChatMessage,
  ChatUserMessage,
} from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

function groupAssistantAndToolMessages(
  messages: ChatMessage[],
): (ChatUserMessage | AssistantToolMessageGroup)[] {
  return messages.reduce(
    (
      acc: (ChatUserMessage | AssistantToolMessageGroup)[],
      message,
    ): (ChatUserMessage | AssistantToolMessageGroup)[] => {
      if (message.role === 'user') {
        // Always push user messages directly
        acc.push(message)
      } else {
        // For assistant or tool messages, check if we can add to an existing group
        const lastItem = acc[acc.length - 1]

        if (Array.isArray(lastItem)) {
          lastItem.push(message)
        } else {
          // Otherwise, create a new group
          acc.push([message])
        }
      }
      return acc
    },
    [],
  )
}

export type ChatMessageRow = {
  messageOrGroup: ChatUserMessage | AssistantToolMessageGroup
  endIndex: number
}

export function buildChatMessageRows(
  messages: ChatMessage[],
): ChatMessageRow[] {
  let endIndex = 0
  return groupAssistantAndToolMessages(messages).map((messageOrGroup) => {
    endIndex += Array.isArray(messageOrGroup) ? messageOrGroup.length : 1
    return { messageOrGroup, endIndex }
  })
}

export function markNonTerminalToolCallsAborted(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map((message) =>
    message.role === 'tool'
      ? {
          ...message,
          toolCalls: message.toolCalls.map((toolCall) =>
            toolCall.response.status ===
              ToolCallResponseStatus.PendingApproval ||
            toolCall.response.status === ToolCallResponseStatus.Running
              ? {
                  ...toolCall,
                  response: { status: ToolCallResponseStatus.Aborted as const },
                }
              : toolCall,
          ),
        }
      : message,
  )
}
