import type { App } from 'obsidian'

import type { ChatConversation } from '../database/json/chat/types'
import type { SerializedChatMessage } from '../types/chat'

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

test('does not save an unchanged conversation after loading it', async () => {
  const messages = [
    { role: 'assistant', id: 'answer', content: 'done' },
  ] as SerializedChatMessage[]
  mockChatManager.findById.mockResolvedValue({
    id: 'chat',
    title: 'Existing chat',
    messages,
    createdAt: 1,
    updatedAt: 2,
    schemaVersion: 1,
  } satisfies ChatConversation)

  const history = useChatHistory()
  const loadedMessages = await history.getChatMessagesById('chat')
  history.createOrUpdateConversation('chat', loadedMessages ?? [])
  await history.flushPendingSave()

  expect(mockChatManager.updateChat).not.toHaveBeenCalled()
  expect(mockChatManager.createChat).not.toHaveBeenCalled()
})
