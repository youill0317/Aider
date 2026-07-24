import {
  AssistantToolMessageGroup,
  ChatMessage,
  ChatUserMessage,
} from '../../types/chat'

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
