import { App } from 'obsidian'

import { CHAT_HISTORY_DIR, ChatConversationManager } from './chatHistoryManager'

jest.mock('obsidian')

const safeId = 'legacy_chat-1'
const unsafeId = '../.obsidian/plugins/aider/data'

function createManager(chatList: unknown[] = [], conversation?: unknown) {
  const adapter = {
    exists: jest.fn().mockResolvedValue(true),
    read: jest.fn((path: string) =>
      Promise.resolve(
        JSON.stringify(
          path.endsWith('/chat_list.json')
            ? chatList
            : (conversation ?? chatList),
        ),
      ),
    ),
    remove: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
  }
  const app = {
    vault: {
      adapter,
      createFolder: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as App

  return { adapter, manager: new ChatConversationManager(app) }
}

describe('ChatConversationManager path safety', () => {
  it('keeps legacy ids but filters traversal ids from the persisted list', async () => {
    const safeChat = {
      schemaVersion: 3,
      id: safeId,
      title: 'Safe',
      createdAt: 1,
      updatedAt: 2,
    }
    const { manager } = createManager([safeChat, { ...safeChat, id: unsafeId }])

    await expect(manager.getChatList()).resolves.toEqual([safeChat])
  })

  it('rejects traversal ids before read, write, or delete', async () => {
    const { adapter, manager } = createManager()

    await expect(manager.findChatConversation(unsafeId)).rejects.toThrow(
      'Invalid chat conversation id',
    )
    await expect(manager.deleteChatConversation(unsafeId)).rejects.toThrow(
      'Invalid chat conversation id',
    )
    await expect(
      manager.saveChatConversation({
        schemaVersion: 3,
        id: unsafeId,
        title: 'Unsafe',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
      }),
    ).rejects.toThrow('Invalid chat conversation id')

    expect(adapter.read).not.toHaveBeenCalled()
    expect(adapter.write).not.toHaveBeenCalled()
    expect(adapter.remove).not.toHaveBeenCalled()
  })

  it('uses safe legacy ids only beneath the history directory', async () => {
    const { adapter, manager } = createManager()

    await manager.findChatConversation(safeId)

    expect(adapter.read).toHaveBeenCalledWith(
      `${CHAT_HISTORY_DIR}/${safeId}.json`,
    )
  })

  it('rejects a conversation file whose embedded id does not match its path', async () => {
    const { manager } = createManager([], {
      schemaVersion: 3,
      id: 'different-safe-id',
      title: 'Mismatched',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
    })

    await expect(manager.findChatConversation(safeId)).resolves.toBeNull()
  })
})
