import { useMemo } from 'react'

import type {
  AssistantToolMessageGroup,
  ChatAssistantMessage,
  ChatMessage,
} from '../../types/chat'

import AssistantMessageAnnotations from './AssistantMessageAnnotations'
import AssistantMessageContent from './AssistantMessageContent'
import AssistantMessageReasoning from './AssistantMessageReasoning'
import AssistantToolMessageGroupActions from './AssistantToolMessageGroupActions'
import type { ToolActivityMessage } from './tool-activity'
import ToolActivityGroup from './ToolActivityGroup'
import type {
  AbortApprovedToolCall,
  ExecuteApprovedToolCall,
  ToolCallResponseUpdater,
} from './ToolMessage'

export type AssistantToolMessageGroupItemProps = {
  messages: AssistantToolMessageGroup
  getContextMessages: () => ChatMessage[]
  conversationId: string
  applyingBlockId: string | null
  onApply: (
    blockToApply: string,
    chatMessages: ChatMessage[],
    applyId: string,
  ) => void
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  onToolCallResponseUpdate: ToolCallResponseUpdater
  isStreaming: boolean
}

export default function AssistantToolMessageGroupItem({
  messages,
  getContextMessages,
  conversationId,
  applyingBlockId,
  onApply,
  executeToolCall,
  abortToolCall,
  onToolCallResponseUpdate,
  isStreaming,
}: AssistantToolMessageGroupItemProps) {
  const messageBlocks = useMemo(() => getMessageBlocks(messages), [messages])
  const lastAssistantMessageId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id

  return (
    <div className="smtcmp-assistant-tool-message-group">
      {messageBlocks.map((block) =>
        block.kind === 'assistant' ? (
          <AssistantMessageBlock
            key={block.message.id}
            message={block.message}
            getContextMessages={getContextMessages}
            applyingBlockId={applyingBlockId}
            onApply={onApply}
            isStreaming={
              isStreaming && block.message.id === lastAssistantMessageId
            }
          />
        ) : (
          <ToolActivityGroup
            key={getActivityBlockKey(block.messages)}
            messages={block.messages}
            conversationId={conversationId}
            executeToolCall={executeToolCall}
            abortToolCall={abortToolCall}
            onToolCallResponseUpdate={onToolCallResponseUpdate}
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
  getContextMessages,
  applyingBlockId,
  onApply,
  isStreaming,
}: {
  message: ChatAssistantMessage
  getContextMessages: () => ChatMessage[]
  applyingBlockId: string | null
  onApply: (
    blockToApply: string,
    chatMessages: ChatMessage[],
    applyId: string,
  ) => void
  isStreaming: boolean
}) {
  if (!message.reasoning && !message.annotations && !message.content) {
    return null
  }

  return (
    <div className="smtcmp-chat-messages-assistant">
      {message.reasoning && (
        <AssistantMessageReasoning
          reasoning={message.reasoning}
          isStreaming={isStreaming}
        />
      )}
      {message.annotations && (
        <AssistantMessageAnnotations annotations={message.annotations} />
      )}
      <AssistantMessageContent
        content={message.content}
        messageId={message.id}
        getContextMessages={getContextMessages}
        handleApply={onApply}
        applyingBlockId={applyingBlockId}
        isStreaming={isStreaming}
      />
    </div>
  )
}
