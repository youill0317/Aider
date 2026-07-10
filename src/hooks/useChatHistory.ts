import debounce from 'lodash.debounce'
import { App, Notice } from 'obsidian'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { editorStateToPlainText } from '../components/chat-view/chat-input/utils/editor-state-to-plain-text'
import { useApp } from '../contexts/app-context'
import { ChatConversationMetadata } from '../database/json/chat/types'
import {
  ChatAgentCommandMessage,
  ChatMessage,
  SerializedChatMessage,
} from '../types/chat'
import { Mentionable } from '../types/mentionable'
import {
  deserializeMentionable,
  serializeMentionable,
} from '../utils/chat/mentionable'

import { ChatSaveQueue } from './chat-save-queue'
import { useChatManager } from './useJsonManagers'

type UseChatHistory = {
  createOrUpdateConversation: (id: string, messages: ChatMessage[]) => void
  flushPendingSave: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  getChatMessagesById: (id: string) => Promise<ChatMessage[] | null>
  updateConversationTitle: (id: string, title: string) => Promise<void>
  chatList: ChatConversationMetadata[]
}

export function useChatHistory(): UseChatHistory {
  const app = useApp()
  const chatManager = useChatManager()
  const [chatList, setChatList] = useState<ChatConversationMetadata[]>([])

  const fetchChatList = useCallback(async () => {
    const list = await chatManager.listChats()
    setChatList(list)
  }, [chatManager])

  useEffect(() => {
    void fetchChatList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cacheConversation = useCallback(
    ({ id, title, updatedAt, schemaVersion }: ChatConversationMetadata) => {
      setChatList((current) =>
        [
          { id, title, updatedAt, schemaVersion },
          ...current.filter((conversation) => conversation.id !== id),
        ].sort((a, b) => b.updatedAt - a.updatedAt),
      )
    },
    [],
  )

  const persistConversation = useCallback(
    async (id: string, messages: ChatMessage[]) => {
      const serializedMessages = messages.map(serializeChatMessage)
      const existingConversation = await chatManager.findById(id)
      if (
        existingConversation &&
        serializedMessagesEqual(
          existingConversation.messages,
          serializedMessages,
        )
      ) {
        return
      }

      let conversation = await chatManager.updateChat(id, {
        messages: serializedMessages,
      })

      if (!conversation) {
        const firstUserMessage = messages.find(
          (message) => message.role === 'user',
        )
        conversation = await chatManager.createChat({
          id,
          title: firstUserMessage?.content
            ? editorStateToPlainText(firstUserMessage.content).substring(0, 50)
            : 'New chat',
          messages: serializedMessages,
        })
      }

      cacheConversation(conversation)
    },
    [cacheConversation, chatManager],
  )

  const saveQueue = useMemo(
    () =>
      new ChatSaveQueue(persistConversation, (error) => {
        new Notice('Failed to save chat history')
        console.error('Failed to save chat history', error)
      }),
    [persistConversation],
  )

  const debouncedSave = useMemo(
    () => debounce(() => saveQueue.drain(), 300, { maxWait: 1000 }),
    [saveQueue],
  )

  const createOrUpdateConversation = useCallback(
    (id: string, messages: ChatMessage[]) => {
      saveQueue.schedule(id, messages)
      debouncedSave()
    },
    [debouncedSave, saveQueue],
  )

  const flushPendingSave = useCallback(async () => {
    debouncedSave.flush()
    await saveQueue.flush()
  }, [debouncedSave, saveQueue])

  useEffect(() => {
    return () => {
      debouncedSave.flush()
    }
  }, [debouncedSave])

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await saveQueue.delete(id, async () => {
        await chatManager.deleteChat(id)
        setChatList((current) =>
          current.filter((conversation) => conversation.id !== id),
        )
      })
    },
    [chatManager, saveQueue],
  )

  const getChatMessagesById = useCallback(
    async (id: string): Promise<ChatMessage[] | null> => {
      const conversation = await chatManager.findById(id)
      if (!conversation) {
        return null
      }
      return conversation.messages.map((message) =>
        deserializeChatMessage(message, app),
      )
    },
    [chatManager, app],
  )

  const updateConversationTitle = useCallback(
    async (id: string, title: string): Promise<void> => {
      if (title.length === 0) {
        throw new Error('Chat title cannot be empty')
      }
      const updatedConversation = await saveQueue.mutate(() =>
        chatManager.updateChat(id, { title }),
      )
      if (!updatedConversation) {
        throw new Error('Conversation not found')
      }
      cacheConversation(updatedConversation)
    },
    [cacheConversation, chatManager, saveQueue],
  )

  return {
    createOrUpdateConversation,
    flushPendingSave,
    deleteConversation,
    getChatMessagesById,
    updateConversationTitle,
    chatList,
  }
}

const serializeChatMessage = (message: ChatMessage): SerializedChatMessage => {
  switch (message.role) {
    case 'user':
      return {
        role: 'user',
        content: message.content,
        promptContent: message.promptContent,
        id: message.id,
        mentionables: message.mentionables.map(serializeMentionable),
        similaritySearchResults: message.similaritySearchResults,
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        reasoning: message.reasoning,
        annotations: message.annotations,
        toolCallRequests: message.toolCallRequests,
        id: message.id,
        metadata: message.metadata,
        providerMetadata: message.providerMetadata,
      }
    case 'tool':
      return {
        role: 'tool',
        toolCalls: message.toolCalls,
        id: message.id,
      }
    case 'agent-command':
      return normalizeAgentCommandMessage(message)
  }
}

const serializedMessagesEqual = (
  left: SerializedChatMessage[],
  right: SerializedChatMessage[],
): boolean => {
  const keys = new Set<string>()
  JSON.stringify([left, right], (key, value: unknown) => {
    keys.add(key)
    return value
  })
  const sortedKeys = [...keys].sort()
  return JSON.stringify(left, sortedKeys) === JSON.stringify(right, sortedKeys)
}

const normalizeAgentCommandMessage = (
  message: ChatAgentCommandMessage,
): ChatAgentCommandMessage => {
  if (message.title && message.kind) {
    return message
  }

  const legacyMessage = message as ChatAgentCommandMessage & {
    readonly command?: string
  }
  const command = legacyMessage.command ?? ''
  return {
    detail: command,
    exitCode: message.exitCode ?? null,
    id: message.id,
    input: '',
    kind: 'command',
    output: message.output,
    role: 'agent-command',
    status: message.status,
    title: '>_',
  }
}

const deserializeChatMessage = (
  message: SerializedChatMessage,
  app: App,
): ChatMessage => {
  switch (message.role) {
    case 'user': {
      return {
        role: 'user',
        content: message.content,
        promptContent: message.promptContent,
        id: message.id,
        mentionables: message.mentionables
          .map((m) => deserializeMentionable(m, app))
          .filter((m): m is Mentionable => m !== null),
        similaritySearchResults: message.similaritySearchResults,
      }
    }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        reasoning: message.reasoning,
        annotations: message.annotations,
        toolCallRequests: message.toolCallRequests,
        id: message.id,
        metadata: message.metadata,
        providerMetadata: message.providerMetadata,
      }
    case 'tool':
      return {
        role: 'tool',
        toolCalls: message.toolCalls,
        id: message.id,
      }
    case 'agent-command':
      return message
  }
}
