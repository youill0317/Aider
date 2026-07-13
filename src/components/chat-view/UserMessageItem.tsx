import { SerializedEditorState } from 'lexical'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { ChatUserMessage } from '../../types/chat'
import { Mentionable } from '../../types/mentionable'
import {
  getMentionableKey,
  getMentionableName,
  serializeMentionable,
} from '../../utils/chat/mentionable'

import ChatUserInput, {
  ChatSubmitMode,
  ChatUserInputRef,
} from './chat-input/ChatUserInput'
import { editorStateToPlainText } from './chat-input/utils/editor-state-to-plain-text'
import SimilaritySearchResults from './SimilaritySearchResults'

export type UserMessageItemProps = {
  message: ChatUserMessage
  chatUserInputRef: (ref: ChatUserInputRef | null) => void
  onSubmit: (
    content: SerializedEditorState,
    mentionables: Mentionable[],
    mode?: ChatSubmitMode,
  ) => void
  onFocus: () => void
  onEditEnd: () => void
}

export default function UserMessageItem({
  message,
  chatUserInputRef,
  onSubmit,
  onFocus,
  onEditEnd,
}: UserMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(message.content)
  const [draftMentionables, setDraftMentionables] = useState(
    message.mentionables,
  )
  const visibleMentionables = message.mentionables.filter(
    (mentionable) =>
      mentionable.type !== 'current-file' || mentionable.file !== null,
  )

  return (
    <div className="smtcmp-chat-messages-user">
      {isEditing ? (
        <ChatUserInput
          ref={chatUserInputRef}
          initialSerializedEditorState={draftContent}
          onChange={setDraftContent}
          onSubmit={(content, mode) => {
            setIsEditing(false)
            onSubmit(content, draftMentionables, mode)
            onEditEnd()
          }}
          onFocus={onFocus}
          mentionables={draftMentionables}
          setMentionables={setDraftMentionables}
          onDone={() => {
            setIsEditing(false)
            onEditEnd()
          }}
          autoFocus
        />
      ) : (
        <div className="smtcmp-user-message">
          <div className="smtcmp-user-message-content">
            {message.content ? editorStateToPlainText(message.content) : ''}
          </div>
          {visibleMentionables.length > 0 && (
            <div
              className="smtcmp-user-message-contexts"
              aria-label="Included context"
            >
              {visibleMentionables.map((mentionable) => (
                <span
                  className="smtcmp-user-message-context"
                  key={getMentionableKey(serializeMentionable(mentionable))}
                >
                  {getMentionableName(mentionable)}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="clickable-icon smtcmp-user-message-edit"
            aria-label="Edit message"
            onClick={() => {
              setDraftContent(message.content)
              setDraftMentionables(message.mentionables)
              setIsEditing(true)
            }}
          >
            <Pencil size={13} />
          </button>
        </div>
      )}
      {message.similaritySearchResults && (
        <SimilaritySearchResults
          similaritySearchResults={message.similaritySearchResults}
        />
      )}
    </div>
  )
}
