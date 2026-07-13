import { App } from 'obsidian'

import { ChatManager } from './ChatManager'
import { CHAT_SCHEMA_VERSION, ChatConversation } from './types'

const mockAdapter = {
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  read: jest.fn().mockResolvedValue(''),
  write: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ type: 'file', size: 1 }),
  list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
}

const mockVault = {
  adapter: mockAdapter,
}

const mockApp = {
  vault: mockVault,
} as unknown as App

describe('ChatManager', () => {
  let chatManager: ChatManager

  beforeEach(() => {
    jest.clearAllMocks()
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.list.mockResolvedValue({ files: [], folders: [] })
    chatManager = new ChatManager(mockApp)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('filename generation and parsing roundtrip', () => {
    const testTitles = [
      'Simple Title',
      'Special & Characters! #$%^',
      'Unicode 中文 日本語 한국어',
      'Extremely long title that might cause issues with file systems',
      'Title with trailing spaces   ',
      '   Title with leading spaces',
      'Title with _ underscores_and_special_chars',
      'Title with.dots.and-dashes',
      'Title with / slashes \\ and \\ backslashes',
      'Title with "quotes" and \'apostrophes\'',
      'Title with <html> tags',
      'Title with newlines\nand\ttabs',
      '🔥 Title with emojis 🚀',
      ' ',
      'Title-with-123e4567-e89b-12d3-a456-426614174000-uuid-like-substring',
      '_Title_starting_with_underscore',
      'Title+with+plus+signs',
      'Title%20with%20encoded%20characters',
      'Title ending with .json',
      'v1_Title_starting_like_a_versioned_file',
      '..Title with leading dots',
      'Title with trailing dots..',
    ]

    test.each(testTitles)('should correctly roundtrip title: %s', (title) => {
      const chat: ChatConversation = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title,
        messages: [],
        createdAt: 1620000000000,
        updatedAt: 1620000000000,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileName = (chatManager as any).generateFileName(chat)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = (chatManager as any).parseFileName(fileName)

      expect(metadata).not.toBeNull()
      if (metadata) {
        expect(metadata.id).toBe(chat.id)
        expect(metadata.title).toBe(chat.title)
        expect(metadata.updatedAt).toBe(chat.updatedAt)
        expect(metadata.schemaVersion).toBe(chat.schemaVersion)
      }
    })
  })

  it('skips malformed percent-encoded filenames', async () => {
    mockAdapter.list.mockResolvedValue({
      files: [
        '.aider_json_db/chats/v1_%E0%A4%A_1620000000000_123e4567-e89b-12d3-a456-426614174000.json',
      ],
      folders: [],
    })

    await expect(chatManager.listChats()).resolves.toEqual([])
  })

  it('preserves a valid caller ID but not generated timestamps or schema', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1620000000000)
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/chats'),
    )
    const id = '123e4567-e89b-42d3-a456-426614174000'

    const chat = await chatManager.createChat({
      id,
      title: 'Title',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 999,
    } as Parameters<ChatManager['createChat']>[0])

    expect(chat).toEqual({
      id,
      title: 'Title',
      messages: [],
      createdAt: 1620000000000,
      updatedAt: 1620000000000,
      schemaVersion: CHAT_SCHEMA_VERSION,
    })
    expect(JSON.parse(String(mockAdapter.write.mock.calls[0][1]))).toEqual(chat)
  })

  it('rejects non-UUID caller IDs before writing', async () => {
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/chats'),
    )

    await expect(
      chatManager.createChat({ id: '../../outside', messages: [] }),
    ).rejects.toThrow('Invalid chat ID')
    expect(mockAdapter.write).not.toHaveBeenCalled()
  })

  it('parses path-safe legacy non-UUID chat ids', () => {
    const chat: ChatConversation = {
      id: 'legacy_chat-123',
      title: 'Legacy chat',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const fileMethods = chatManager as unknown as {
      parseFileName: (fileName: string) => { id: string } | null
      generateFileName: (value: ChatConversation) => string
    }
    const metadata = fileMethods.parseFileName(
      fileMethods.generateFileName(chat),
    )

    expect(metadata?.id).toBe('legacy_chat-123')
  })

  it.each([
    ['invalid message collection', 'not-an-array'],
    ['invalid nested message', [{ id: 'message-id', role: 'user' }]],
  ])('ignores conversation JSON with %s', async (_case, messages) => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({
        id: 'valid-id',
        title: 'Broken chat',
        messages,
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }),
    )

    await expect(chatManager.read('chat.json')).resolves.toBeNull()
  })
})
