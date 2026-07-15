import { App } from 'obsidian'

import { ChatConversationManager } from '../../utils/chat/chatHistoryManager'
import { DatabaseManager } from '../DatabaseManager'

import { ChatManager } from './chat/ChatManager'
import { INITIAL_MIGRATION_MARKER } from './constants'
import { migrateToJsonDatabase } from './migrateToJsonDatabase'
import { TemplateManager } from './template/TemplateManager'

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
const migratedChat = { ...legacyChat, schemaVersion: 1 }

function createApp(markerExists = false) {
  const markerContent = `Migration completed on ${new Date(0).toISOString()}`
  const adapter = {
    exists: jest
      .fn()
      .mockImplementation(async (filePath: string) =>
        filePath.endsWith(INITIAL_MIGRATION_MARKER) ? markerExists : true,
      ),
    list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
    mkdir: jest.fn().mockResolvedValue(undefined),
    read: jest
      .fn()
      .mockImplementation(async (filePath: string) =>
        filePath.endsWith(INITIAL_MIGRATION_MARKER)
          ? markerContent
          : JSON.stringify([]),
      ),
    stat: jest.fn().mockResolvedValue({ type: 'file', size: 1 }),
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
    jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockRejectedValue(new Error('write failed'))

    await expect(
      migrateToJsonDatabase(app, getDatabaseManager),
    ).rejects.toThrow('failed for 1 record')
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('skips stale chat list entries and completes migration', async () => {
    const { app, adapter } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(null)
    const importChat = jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockResolvedValue(migratedChat)

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(importChat).not.toHaveBeenCalled()
    expect(getDatabaseManager).toHaveBeenCalledTimes(1)
    expect(adapter.rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\.aider_json_db\/\.aider-.*\.tmp$/),
      `.aider_json_db/${INITIAL_MIGRATION_MARKER}`,
    )
  })

  it('ignores unsafe legacy chat ids before reading migration files', async () => {
    const { app, adapter } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    adapter.read.mockResolvedValue(
      JSON.stringify([
        {
          ...legacyChat,
          id: '../.obsidian/plugins/aider/data',
        },
      ]),
    )
    const importChat = jest.spyOn(ChatManager.prototype, 'importChat')

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(adapter.read).toHaveBeenCalledTimes(1)
    expect(importChat).not.toHaveBeenCalled()
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
      .spyOn(ChatConversationManager.prototype, 'deleteChatConversations')
      .mockResolvedValue([])
    const importChat = jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockResolvedValue(migratedChat)

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(importChat).toHaveBeenCalled()
    expect(importChat.mock.invocationCallOrder[0]).toBeLessThan(
      deleteSource.mock.invocationCallOrder[0],
    )
    expect(adapter.rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\.aider_json_db\/\.aider-.*\.tmp$/),
      `.aider_json_db/${INITIAL_MIGRATION_MARKER}`,
    )
  })

  it('fails instead of hiding a legacy chat behind a conflicting target id', async () => {
    const { app } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(legacyChat)
    jest
      .spyOn(ChatManager.prototype, 'listChatConversations')
      .mockResolvedValue([
        {
          ...legacyChat,
          schemaVersion: 1,
          title: 'Different chat',
        },
      ])
    const deleteSource = jest.spyOn(
      ChatConversationManager.prototype,
      'deleteChatConversations',
    )

    await expect(
      migrateToJsonDatabase(app, getDatabaseManager),
    ).rejects.toThrow('failed for 1 record')
    expect(deleteSource).toHaveBeenCalledWith([])
  })

  it('does not trust a malformed migration marker', async () => {
    const { app, adapter } = createApp(true)
    adapter.read.mockResolvedValueOnce('not a valid marker')
    const { getDatabaseManager } = createDatabaseGetter()
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([])

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(getDatabaseManager).toHaveBeenCalledTimes(1)
  })

  it('saves the legacy database once after migrating multiple templates', async () => {
    const { app } = createApp()
    const templates = [
      {
        id: 'one',
        name: 'One',
        content: { nodes: [{ type: 'text', version: 1 }] },
      },
      {
        id: 'two',
        name: 'Two',
        content: { nodes: [{ type: 'text', version: 1 }] },
      },
    ]
    const templateManager = {
      findAllTemplates: jest.fn().mockResolvedValue(templates),
      deleteTemplate: jest.fn().mockResolvedValue(true),
      saveChanges: jest.fn().mockResolvedValue(undefined),
    }
    const getDatabaseManager = jest.fn().mockResolvedValue({
      getTemplateManager: () => templateManager,
    } as unknown as DatabaseManager)
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([])
    jest.spyOn(TemplateManager.prototype, 'listTemplates').mockResolvedValue([])
    jest
      .spyOn(TemplateManager.prototype, 'importTemplate')
      .mockImplementation(async ({ name, content }) => ({
        id: `${name.toLowerCase()}-id`,
        name,
        content,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      }))

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(templateManager.deleteTemplate).toHaveBeenNthCalledWith(
      1,
      'one',
      false,
    )
    expect(templateManager.deleteTemplate).toHaveBeenNthCalledWith(
      2,
      'two',
      false,
    )
    expect(templateManager.saveChanges).toHaveBeenCalledTimes(1)
  })

  it('fails when an existing target template has different content', async () => {
    const { app } = createApp()
    const legacyTemplate = {
      id: 'legacy-template',
      name: 'Shared name',
      content: { nodes: [{ type: 'text', version: 1, text: 'legacy' }] },
    }
    const templateManager = {
      findAllTemplates: jest.fn().mockResolvedValue([legacyTemplate]),
      deleteTemplate: jest.fn(),
      saveChanges: jest.fn(),
    }
    const getDatabaseManager = jest.fn().mockResolvedValue({
      getTemplateManager: () => templateManager,
    } as unknown as DatabaseManager)
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([])
    jest.spyOn(TemplateManager.prototype, 'listTemplates').mockResolvedValue([
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: legacyTemplate.name,
        content: {
          nodes: [{ type: 'text', version: 1, text: 'target' }],
        } as never,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      },
    ])

    await expect(
      migrateToJsonDatabase(app, getDatabaseManager),
    ).rejects.toThrow('failed for 1 record')
    expect(templateManager.deleteTemplate).not.toHaveBeenCalled()
  })

  it('removes a legacy template when the existing target is identical', async () => {
    const { app } = createApp()
    const legacyTemplate = {
      id: 'legacy-template',
      name: 'Shared name',
      content: { nodes: [{ type: 'text', version: 1, text: 'same' }] },
    }
    const templateManager = {
      findAllTemplates: jest.fn().mockResolvedValue([legacyTemplate]),
      deleteTemplate: jest.fn().mockResolvedValue(true),
      saveChanges: jest.fn().mockResolvedValue(undefined),
    }
    const getDatabaseManager = jest.fn().mockResolvedValue({
      getTemplateManager: () => templateManager,
    } as unknown as DatabaseManager)
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([])
    jest.spyOn(TemplateManager.prototype, 'listTemplates').mockResolvedValue([
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        name: legacyTemplate.name,
        content: legacyTemplate.content,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      },
    ])

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(templateManager.deleteTemplate).toHaveBeenCalledWith(
      legacyTemplate.id,
      false,
    )
    expect(templateManager.saveChanges).toHaveBeenCalledTimes(1)
  })

  it('normalizes legacy agent commands before importing and deleting the source', async () => {
    const { app } = createApp()
    const { getDatabaseManager } = createDatabaseGetter()
    const sourceChat = {
      ...legacyChat,
      messages: [
        {
          id: 'command-1',
          role: 'agent-command',
          command: 'git status',
          output: 'clean',
          status: 'success',
          exitCode: 0,
        },
      ],
    }
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(sourceChat as never)
    jest
      .spyOn(ChatManager.prototype, 'listChatConversations')
      .mockResolvedValue([])
    const importChat = jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockImplementation(async (chat) => ({ ...chat, schemaVersion: 1 }))
    const deleteSource = jest
      .spyOn(ChatConversationManager.prototype, 'deleteChatConversations')
      .mockResolvedValue([])

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(importChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            title: 'git status',
            detail: '',
            input: 'git status',
            kind: 'command',
          }),
        ],
      }),
    )
    expect(deleteSource).toHaveBeenCalledWith([legacyChat.id])
  })

  it('loads each target collection once and reuses newly imported records', async () => {
    const { app } = createApp()
    const sourceTemplates = [
      {
        id: 'template-one',
        name: 'Shared',
        content: { nodes: [{ type: 'text', version: 1, text: 'same' }] },
      },
      {
        id: 'template-two',
        name: 'Shared',
        content: { nodes: [{ type: 'text', version: 1, text: 'same' }] },
      },
    ]
    const templateManager = {
      findAllTemplates: jest.fn().mockResolvedValue(sourceTemplates),
      deleteTemplate: jest.fn().mockResolvedValue(true),
      saveChanges: jest.fn().mockResolvedValue(undefined),
    }
    const getDatabaseManager = jest.fn().mockResolvedValue({
      getTemplateManager: () => templateManager,
    } as unknown as DatabaseManager)
    jest
      .spyOn(ChatConversationManager.prototype, 'getChatList')
      .mockResolvedValue([legacyChat, legacyChat])
    jest
      .spyOn(ChatConversationManager.prototype, 'findChatConversation')
      .mockResolvedValue(legacyChat)
    const listChats = jest
      .spyOn(ChatManager.prototype, 'listChatConversations')
      .mockResolvedValue([])
    const importChat = jest
      .spyOn(ChatManager.prototype, 'importChat')
      .mockResolvedValue(migratedChat)
    const findChat = jest.spyOn(ChatManager.prototype, 'findById')
    const listTemplates = jest
      .spyOn(TemplateManager.prototype, 'listTemplates')
      .mockResolvedValue([])
    const importTemplate = jest
      .spyOn(TemplateManager.prototype, 'importTemplate')
      .mockImplementation(async ({ name, content }) => ({
        id: 'target-template',
        name,
        content,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: 1,
      }))
    const findTemplate = jest.spyOn(TemplateManager.prototype, 'findByName')

    await migrateToJsonDatabase(app, getDatabaseManager)

    expect(listChats).toHaveBeenCalledTimes(1)
    expect(importChat).toHaveBeenCalledTimes(1)
    expect(findChat).not.toHaveBeenCalled()
    expect(listTemplates).toHaveBeenCalledTimes(1)
    expect(importTemplate).toHaveBeenCalledTimes(1)
    expect(findTemplate).not.toHaveBeenCalled()
    expect(templateManager.deleteTemplate).toHaveBeenCalledTimes(2)
  })
})
