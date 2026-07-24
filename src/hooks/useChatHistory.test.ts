import type { App } from 'obsidian'

import type { ChatConversation } from '../database/json/chat/types'
import type { ChatMessage, SerializedChatMessage } from '../types/chat'

import { useChatHistory } from './useChatHistory'

const mockApp = {} as App
const mockChatManager = {
  createChat: jest.fn(),
  deleteChat: jest.fn(),
  findById: jest.fn(),
  listChats: jest.fn(),
  updateChat: jest.fn(),
}

jest.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initialValue: unknown) => [initialValue, jest.fn()],
}))

jest.mock('lodash.debounce', () => ({
  __esModule: true,
  default: (callback: () => void) =>
    Object.assign(callback, { flush: callback }),
}))

jest.mock('../contexts/app-context', () => ({
  useApp: () => mockApp,
}))

jest.mock('./useJsonManagers', () => ({
  useChatManager: () => mockChatManager,
}))

beforeEach(() => {
  jest.clearAllMocks()
})

test('loads the latest pending snapshot during rapid conversation switches', async () => {
  const latestMessages = [
    { role: 'assistant', id: 'latest', content: 'latest response' },
  ] as ChatMessage[]
  mockChatManager.updateChat.mockReturnValue(new Promise(() => undefined))
  const history = useChatHistory()

  history.createOrUpdateConversation('chat', latestMessages)
  const loadedMessages = await history.getChatMessagesById('chat')

  expect(loadedMessages).toBe(latestMessages)
  expect(mockChatManager.findById).not.toHaveBeenCalled()
})

test('delegates unchanged conversation detection to the manager', async () => {
  const messages = [
    { role: 'assistant', id: 'answer', content: 'done' },
  ] as SerializedChatMessage[]
  const conversation = {
    id: 'chat',
    title: 'Existing chat',
    messages,
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: 1,
  } satisfies ChatConversation
  mockChatManager.findById.mockResolvedValue(conversation)
  mockChatManager.updateChat.mockResolvedValue(conversation)

  const history = useChatHistory()
  const loadedMessages = await history.getChatMessagesById('chat')
  history.createOrUpdateConversation('chat', loadedMessages ?? [])
  await history.flushPendingSave()

  expect(mockChatManager.findById).toHaveBeenCalledTimes(1)
  expect(mockChatManager.updateChat).toHaveBeenCalledTimes(1)
  expect(mockChatManager.updateChat).toHaveBeenCalledWith('chat', { messages })
  expect(mockChatManager.createChat).not.toHaveBeenCalled()
})

test('does not duplicate legacy persisted images when loading a chat', async () => {
  const imageData = 'data:image/png;base64,AAAA'
  const messages = [
    {
      role: 'user',
      id: 'question',
      content: null,
      promptContent: [
        { type: 'image_url', image_url: { url: imageData } },
        { type: 'text', text: 'describe this' },
      ],
      mentionables: [
        {
          type: 'image',
          name: 'image.png',
          mimeType: 'image/png',
          data: imageData,
        },
      ],
    },
  ] satisfies SerializedChatMessage[]
  mockChatManager.findById.mockResolvedValue({
    id: 'chat-with-image',
    title: 'Image chat',
    messages,
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: 1,
  } satisfies ChatConversation)

  const loadedMessages =
    await useChatHistory().getChatMessagesById('chat-with-image')

  const loadedMessage = loadedMessages?.[0]
  expect(loadedMessage?.role).toBe('user')
  if (loadedMessage?.role !== 'user') {
    throw new Error('Expected a user message')
  }
  expect(loadedMessage.promptContent).toEqual([
    { type: 'image_url', image_url: { url: imageData } },
    { type: 'text', text: 'describe this' },
  ])
})
