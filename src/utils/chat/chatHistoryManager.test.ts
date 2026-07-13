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
    stat: jest.fn().mockResolvedValue({ type: 'file', size: 1 }),
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

  it('filters unsupported and non-integer schema versions', async () => {
    const base = {
      id: safeId,
      title: 'Safe',
      createdAt: 1,
      updatedAt: 2,
    }
    const { manager } = createManager([
      { ...base, schemaVersion: 2 },
      { ...base, id: 'future', schemaVersion: 4 },
      { ...base, id: 'fractional', schemaVersion: 2.5 },
    ])

    await expect(manager.getChatList()).resolves.toEqual([
      { ...base, schemaVersion: 2 },
    ])
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

  it('deletes a migration batch with one chat-list rewrite', async () => {
    const chats = ['one', 'two'].map((id) => ({
      schemaVersion: 3,
      id,
      title: id,
      createdAt: 1,
      updatedAt: 2,
    }))
    const { adapter, manager } = createManager(chats)

    await expect(
      manager.deleteChatConversations(['one', 'two']),
    ).resolves.toEqual([])

    expect(adapter.remove).toHaveBeenCalledTimes(2)
    expect(adapter.write).toHaveBeenCalledTimes(1)
    expect(adapter.write).toHaveBeenCalledWith(
      `${CHAT_HISTORY_DIR}/chat_list.json`,
      '[]',
    )
  })
})
