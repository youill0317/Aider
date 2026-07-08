import { useMemo } from 'react'

import type {
  AssistantToolMessageGroup,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
} from '../../types/chat'

import AssistantMessageAnnotations from './AssistantMessageAnnotations'
import AssistantMessageContent from './AssistantMessageContent'
import AssistantMessageReasoning from './AssistantMessageReasoning'
import AssistantToolMessageGroupActions from './AssistantToolMessageGroupActions'
import type { ToolActivityMessage } from './tool-activity'
import ToolActivityGroup from './ToolActivityGroup'

export type AssistantToolMessageGroupItemProps = {
  messages: AssistantToolMessageGroup
  contextMessages: ChatMessage[]
  conversationId: string
  isApplying: boolean // TODO: isApplying should be a boolean for each assistant message
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
  onToolMessageUpdate: (message: ChatToolMessage) => void
}

export default function AssistantToolMessageGroupItem({
  messages,
  contextMessages,
  conversationId,
  isApplying,
  onApply,
  onToolMessageUpdate,
}: AssistantToolMessageGroupItemProps) {
  const messageBlocks = useMemo(() => getMessageBlocks(messages), [messages])

  return (
    <div className="smtcmp-assistant-tool-message-group">
      {messageBlocks.map((block) =>
        block.kind === 'assistant' ? (
          <AssistantMessageBlock
            key={block.message.id}
            message={block.message}
            contextMessages={contextMessages}
            isApplying={isApplying}
            onApply={onApply}
          />
        ) : (
          <ToolActivityGroup
            key={getActivityBlockKey(block.messages)}
            messages={block.messages}
            conversationId={conversationId}
            onToolMessageUpdate={onToolMessageUpdate}
          />
        ),
      )}
      {messages.length > 0 && (
        <AssistantToolMessageGroupActions messages={messages} />
      )}
    </div>
  )
}

type MessageBlock =
  | {
      readonly kind: 'assistant'
      readonly message: ChatAssistantMessage
    }
  | {
      readonly kind: 'activity'
      readonly messages: ToolActivityMessage[]
    }

function getMessageBlocks(messages: AssistantToolMessageGroup): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let activityMessages: ToolActivityMessage[] = []

  const flushActivityMessages = () => {
    if (activityMessages.length === 0) {
      return
    }

    blocks.push({
      kind: 'activity',
      messages: activityMessages,
    })
    activityMessages = []
  }

  for (const message of messages) {
    if (message.role === 'assistant') {
      flushActivityMessages()
      blocks.push({ kind: 'assistant', message })
    } else {
      activityMessages.push(message)
    }
  }

  flushActivityMessages()
  return blocks
}

function getActivityBlockKey(messages: readonly ToolActivityMessage[]): string {
  return messages.map((message) => message.id).join(':')
}

function AssistantMessageBlock({
  message,
  contextMessages,
  isApplying,
  onApply,
}: {
  message: ChatAssistantMessage
  contextMessages: ChatMessage[]
  isApplying: boolean
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
}) {
  if (!message.reasoning && !message.annotations && !message.content) {
    return null
  }

  return (
    <div className="smtcmp-chat-messages-assistant">
      {message.reasoning && (
        <AssistantMessageReasoning reasoning={message.reasoning} />
      )}
      {message.annotations && (
        <AssistantMessageAnnotations annotations={message.annotations} />
      )}
      <AssistantMessageContent
        content={message.content}
        contextMessages={contextMessages}
        handleApply={onApply}
        isApplying={isApplying}
      />
    </div>
  )
}
