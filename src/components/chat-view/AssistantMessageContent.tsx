import React, { useCallback, useMemo } from 'react'

import { ChatAssistantMessage, ChatMessage } from '../../types/chat'
import {
  ParsedTagContent,
  parseTagContents,
} from '../../utils/chat/parse-tag-content'

import AssistantMessageReasoning from './AssistantMessageReasoning'
import MarkdownCodeComponent from './MarkdownCodeComponent'
import MarkdownReferenceBlock from './MarkdownReferenceBlock'
import { UntrustedMarkdown } from './UntrustedMarkdown'

export default function AssistantMessageContent({
  content,
  messageId,
  getContextMessages,
  handleApply,
  applyingBlockId,
  isStreaming = false,
}: {
  content: ChatAssistantMessage['content']
  messageId: ChatAssistantMessage['id']
  getContextMessages: () => ChatMessage[]
  handleApply: (
    blockToApply: string,
    chatMessages: ChatMessage[],
    applyId: string,
  ) => void
  applyingBlockId: string | null
  isStreaming?: boolean
}) {
  const onApply = useCallback(
    (blockToApply: string, applyId: string) => {
      handleApply(blockToApply, getContextMessages(), applyId)
    },
    [getContextMessages, handleApply],
  )

  return (
    <AssistantTextRenderer
      messageId={messageId}
      onApply={onApply}
      applyingBlockId={applyingBlockId}
      isStreaming={isStreaming}
    >
      {content}
    </AssistantTextRenderer>
  )
}

const AssistantTextRenderer = React.memo(function AssistantTextRenderer({
  messageId,
  onApply,
  applyingBlockId,
  isStreaming,
  children,
}: {
  messageId: string
  onApply: (blockToApply: string, applyId: string) => void
  children: string
  applyingBlockId: string | null
  isStreaming: boolean
}) {
  const blocks: ParsedTagContent[] = useMemo(
    () => (isStreaming ? [] : parseTagContents(children)),
    [children, isStreaming],
  )

  if (isStreaming) {
    return <pre className="smtcmp-streaming-response">{children}</pre>
  }

  return (
    <>
      {blocks.map((block, index) =>
        block.type === 'string' ? (
          <div key={index}>
            <UntrustedMarkdown content={block.content} scale="sm" />
          </div>
        ) : block.type === 'think' ? (
          <AssistantMessageReasoning key={index} reasoning={block.content} />
        ) : block.startLine && block.endLine && block.filename ? (
          <MarkdownReferenceBlock
            key={index}
            filename={block.filename}
            startLine={block.startLine}
            endLine={block.endLine}
          />
        ) : (
          <MarkdownCodeComponent
            key={index}
            applyId={`${messageId}:${index}`}
            onApply={onApply}
            applyingBlockId={applyingBlockId}
            language={block.language}
            filename={block.filename}
          >
            {block.content}
          </MarkdownCodeComponent>
        ),
      )}
    </>
  )
})
