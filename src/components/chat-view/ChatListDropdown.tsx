import * as Popover from '@radix-ui/react-popover'
import { Pencil, Trash2 } from 'lucide-react'
import { Notice } from 'obsidian'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatConversationMetadata } from '../../database/json/chat/types'

function TitleInput({
  title,
  onSubmit,
}: {
  title: string
  onSubmit: (title: string) => Promise<void>
}) {
  const [value, setValue] = useState(title)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit(value.trim() || title)
    } catch (error) {
      new Notice('Failed to rename conversation')
      console.error('Failed to rename conversation', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select()
      inputRef.current.scrollLeft = 0
    }
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label="Conversation title"
      value={value}
      disabled={isSubmitting}
      className="smtcmp-chat-list-dropdown-item-title-input"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          void submit()
        }
      }}
      autoFocus
      maxLength={100}
    />
  )
}

function ChatListItem({
  title,
  isFocused,
  isEditing,
  onMouseEnter,
  onFocus,
  itemRef,
  onSelect,
  onDelete,
  onStartEdit,
  onFinishEdit,
}: {
  title: string
  isFocused: boolean
  isEditing: boolean
  onMouseEnter: () => void
  onFocus: () => void
  itemRef: (element: HTMLButtonElement | null) => void
  onSelect: () => Promise<void>
  onDelete: () => Promise<void>
  onStartEdit: () => void
  onFinishEdit: (title: string) => Promise<void>
}) {
  return (
    <li onMouseEnter={onMouseEnter} className={isFocused ? 'selected' : ''}>
      {isEditing ? (
        <TitleInput title={title} onSubmit={onFinishEdit} />
      ) : (
        <button
          ref={itemRef}
          type="button"
          className="smtcmp-chat-list-dropdown-item-select"
          onClick={onSelect}
          onFocus={onFocus}
          tabIndex={isFocused ? 0 : -1}
        >
          <span className="smtcmp-chat-list-dropdown-item-title">{title}</span>
        </button>
      )}
      <div className="smtcmp-chat-list-dropdown-item-actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onStartEdit()
          }}
          className="clickable-icon smtcmp-chat-list-dropdown-item-icon"
          aria-label={`Rename ${title}`}
        >
          <Pencil />
        </button>
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation()
            await onDelete()
          }}
          className="clickable-icon smtcmp-chat-list-dropdown-item-icon"
          aria-label={`Delete ${title}`}
        >
          <Trash2 />
        </button>
      </div>
    </li>
  )
}

export function ChatListDropdown({
  chatList,
  status,
  currentConversationId,
  onSelect,
  onDelete,
  onUpdateTitle,
  children,
}: {
  chatList: ChatConversationMetadata[]
  status: 'loading' | 'ready' | 'error'
  currentConversationId: string
  onSelect: (conversationId: string) => Promise<void>
  onDelete: (conversationId: string) => Promise<void>
  onUpdateTitle: (conversationId: string, newTitle: string) => Promise<void>
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (open) {
      const currentIndex = chatList.findIndex(
        (chat) => chat.id === currentConversationId,
      )
      setFocusedIndex(currentIndex === -1 ? 0 : currentIndex)
      setEditingId(null)
    }
  }, [open, chatList, currentConversationId])

  const focusItem = useCallback(
    (index: number) => {
      if (chatList.length === 0) return
      const nextIndex = Math.max(0, Math.min(chatList.length - 1, index))
      setFocusedIndex(nextIndex)
      requestAnimationFrame(() => {
        const item = itemRefs.current[nextIndex]
        item?.focus()
        item?.scrollIntoView({ block: 'nearest' })
      })
    },
    [chatList.length],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.smtcmp-chat-list-dropdown-item-actions, input'))
        return

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusItem(focusedIndex - 1)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusItem(focusedIndex + 1)
      }
    },
    [focusedIndex, focusItem],
  )

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="clickable-icon"
          aria-label="Chat History"
        >
          {children}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="smtcmp-popover smtcmp-chat-list-dropdown-content"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            if (chatList.length === 0) return
            event.preventDefault()
            const currentIndex = chatList.findIndex(
              (chat) => chat.id === currentConversationId,
            )
            focusItem(currentIndex === -1 ? 0 : currentIndex)
          }}
        >
          <ul aria-label="Chat history">
            {status !== 'ready' || chatList.length === 0 ? (
              <li className="smtcmp-chat-list-dropdown-empty">
                {status === 'loading'
                  ? 'Loading conversations…'
                  : status === 'error'
                    ? 'Unable to load conversations'
                    : 'No conversations'}
              </li>
            ) : (
              chatList.map((chat, index) => (
                <ChatListItem
                  key={chat.id}
                  title={chat.title}
                  isFocused={focusedIndex === index}
                  isEditing={editingId === chat.id}
                  itemRef={(element) => {
                    itemRefs.current[index] = element
                  }}
                  onMouseEnter={() => {
                    setFocusedIndex(index)
                  }}
                  onFocus={() => setFocusedIndex(index)}
                  onSelect={async () => {
                    await onSelect(chat.id)
                    setOpen(false)
                  }}
                  onDelete={async () => {
                    await onDelete(chat.id)
                  }}
                  onStartEdit={() => {
                    setEditingId(chat.id)
                  }}
                  onFinishEdit={async (title) => {
                    await onUpdateTitle(chat.id, title)
                    setEditingId(null)
                    focusItem(index)
                  }}
                />
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
