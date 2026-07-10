import { App } from 'obsidian'

import { ChatConversationManager } from '../../utils/chat/chatHistoryManager'
import { DatabaseManager } from '../DatabaseManager'

import { ChatManager } from './chat/ChatManager'
import { INITIAL_MIGRATION_MARKER } from './constants'
import { migrateToJsonDatabase } from './migrateToJsonDatabase'

jest.mock('obsidian')

const chatId = '123e4567-e89b-42d3-a456-426614174000'
const legacyChat = {
  schemaVersion: 3,
  id: chatId,
  title: 'Legacy',
  createdAt: 1,
  updatedAt: 2,
  messages: [],
}

function createApp(markerExists = false) {
  const adapter = {
    exists: jest
      .fn()
      .mockImplementation(async (filePath: string) =>
        filePath.endsWith(INITIAL_MIGRATION_MARKER) ? markerExists : true,
      ),
    list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    mkdir: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
  }
  return {
    app: { vault: { adapter } } as unknown as App,
    adapter,
  }
}

function createDatabaseGetter() {
  const templateManager = {
    findAllTemplates: jest.fn().mockResolvedValue([]),
  }
  const getDatabaseManager = jest.fn().mockResolvedValue({
    getTemplateManager: () => templateManager,
  } as unknown as DatabaseManager)
  return { getDatabaseManager, templateManager }
}

describe('migrateToJsonDatabase', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not initialize PGlite after finding the marker', async () => {
    const { app } = createApp(true)
    const { getDatabaseManager } = createDatabaseGetter()

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(getDatabaseManager).not.toHaveBeenCalled()
  })

  it('does not write a marker when any record fails', async () => {
    const { app, adapter } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(legacyChat)
    jest.spyOn(ChatManager.prototype, 'findById').mockResolvedValue(null)
    jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockRejectedValue(new Error('write failed'))

    await expect(
      migrateToJsonDatabase(app, getDatabaseManager),
    ).rejects.toThrow('failed for 1 record')
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('deletes a source only after verification and atomically marks success', async () => {
    const { app, adapter } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(legacyChat)
    const deleteSource = jest
      .spyOn(ChatConversationManager.prototype, 'deleteChatConversation')
      .mockResolvedValue()
    const findTarget = jest
      .spyOn(ChatManager.prototype, 'findById')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...legacyChat, schemaVersion: 1 })
    const importChat = jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockResolvedValue()

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(importChat).toHaveBeenCalled()
    expect(findTarget.mock.invocationCallOrder[1]).toBeLessThan(
      deleteSource.mock.invocationCallOrder[0],
    )
    expect(adapter.rename).toHaveBeenCalledWith(
      expect.stringContaining(INITIAL_MIGRATION_MARKER),
      expect.stringContaining(INITIAL_MIGRATION_MARKER),
    )
  })
})
