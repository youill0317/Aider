import { App } from 'obsidian'

import { MAX_JSON_FILE_NAME_BYTES } from '../file-name'

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
    mockAdapter.read.mockResolvedValue('')
    mockAdapter.rename.mockResolvedValue(undefined)
    mockAdapter.remove.mockResolvedValue(undefined)
    chatManager = new ChatManager(mockApp)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('filename generation and parsing roundtrip', () => {
    const testTitles = [
      'Simple Title',
      'Special & Characters! #$%^',
      '**Markdown title**',
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

  it.each([
    ['Korean', '한'.repeat(50)],
    ['emoji', '🔥'.repeat(50)],
  ])(
    'bounds a long %s title without splitting Unicode',
    async (_case, title) => {
      mockAdapter.exists.mockImplementation(async (filePath: string) =>
        filePath.endsWith('/chats'),
      )

      const chat = await chatManager.createChat({ title })
      const storedChat = JSON.parse(String(mockAdapter.write.mock.calls[0][1]))
      const temporaryName = String(mockAdapter.write.mock.calls[0][0])
        .split('/')
        .pop()
      const fileName = String(mockAdapter.rename.mock.calls[0][1])
        .split('/')
        .pop()
      const metadata = (
        chatManager as unknown as {
          parseFileName: (value: string) => { title: string } | null
        }
      ).parseFileName(fileName ?? '')

      expect(fileName?.length).toBeLessThanOrEqual(MAX_JSON_FILE_NAME_BYTES)
      expect(temporaryName?.length).toBeLessThan(255)
      expect(chat.title).toBe(title)
      expect(() => encodeURIComponent(chat.title)).not.toThrow()
      expect(storedChat.title).toBe(title)
      expect(metadata?.title.length).toBeLessThan(title.length)
      expect(title.startsWith(metadata?.title ?? '')).toBe(true)

      mockAdapter.exists.mockResolvedValue(true)
      mockAdapter.list.mockResolvedValue({
        files: [`.aider_json_db/chats/${fileName ?? ''}`],
        folders: [],
      })
      mockAdapter.read.mockResolvedValue(JSON.stringify(chat))
      await expect(chatManager.findById(chat.id)).resolves.toEqual(chat)
      await expect(chatManager.listChats()).resolves.toEqual([
        {
          id: chat.id,
          title,
          updatedAt: chat.updatedAt,
          schemaVersion: CHAT_SCHEMA_VERSION,
        },
      ])
    },
  )

  it.each([
    ['old first', ['old', 'new']],
    ['new first', ['new', 'old']],
  ])(
    'prefers the newest valid duplicate and deletes every copy with %s',
    async (_case, order) => {
      const id = '123e4567-e89b-42d3-a456-426614174000'
      const oldChat: ChatConversation = {
        id,
        title: 'Old',
        messages: [],
        createdAt: 1,
        updatedAt: 10,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }
      const newChat = { ...oldChat, title: 'New', updatedAt: 20 }
      const fileMethods = chatManager as unknown as {
        generateFileName: (value: ChatConversation) => string
      }
      const rows = { old: oldChat, new: newChat }
      const fileNames = {
        old: fileMethods.generateFileName(oldChat),
        new: fileMethods.generateFileName(newChat),
      }
      const filePaths = order.map(
        (key) => `.aider_json_db/chats/${fileNames[key as 'old' | 'new']}`,
      )
      mockAdapter.list.mockResolvedValue({ files: filePaths, folders: [] })
      mockAdapter.read.mockImplementation(async (filePath: string) =>
        JSON.stringify(filePath.endsWith(fileNames.new) ? rows.new : rows.old),
      )

      await expect(chatManager.findById(id)).resolves.toEqual(newChat)
      await expect(chatManager.listChats()).resolves.toEqual([
        {
          id,
          title: 'New',
          updatedAt: 20,
          schemaVersion: CHAT_SCHEMA_VERSION,
        },
      ])
      await expect(chatManager.deleteChat(id)).resolves.toBe(true)
      expect(
        mockAdapter.remove.mock.calls
          .map(([filePath]) => String(filePath))
          .sort(),
      ).toEqual([...filePaths].sort())
    },
  )

  it('loads a legacy filename longer than the current filename limit', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const title = 'L'.repeat(180)
    const chat: ChatConversation = {
      id,
      title,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const legacyFileName = `v${CHAT_SCHEMA_VERSION}_${encodeURIComponent(
      title,
    )}_${chat.updatedAt}_${id}.json`
    expect(legacyFileName.length).toBeGreaterThan(MAX_JSON_FILE_NAME_BYTES)
    expect(legacyFileName.length).toBeLessThan(255)
    mockAdapter.list.mockResolvedValue({
      files: [`.aider_json_db/chats/${legacyFileName}`],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))

    await expect(chatManager.findById(id)).resolves.toEqual(chat)
    await expect(chatManager.listChats()).resolves.toEqual([
      {
        id,
        title,
        updatedAt: 1,
        schemaVersion: CHAT_SCHEMA_VERSION,
      },
    ])
  })

  it('skips a newer duplicate whose authoritative metadata disagrees with its row', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const oldChat: ChatConversation = {
      id,
      title: 'Old',
      messages: [],
      createdAt: 1,
      updatedAt: 10,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const mismatchedChat = { ...oldChat, title: 'New', updatedAt: 19 }
    const oldFileName = `v${CHAT_SCHEMA_VERSION}_Old_10_${id}.json`
    const newFileName = `v${CHAT_SCHEMA_VERSION}_New_20_${id}.json`
    mockAdapter.list.mockResolvedValue({
      files: [
        `.aider_json_db/chats/${newFileName}`,
        `.aider_json_db/chats/${oldFileName}`,
      ],
      folders: [],
    })
    mockAdapter.read.mockImplementation(async (filePath: string) =>
      JSON.stringify(filePath.endsWith(newFileName) ? mismatchedChat : oldChat),
    )

    await expect(chatManager.findById(id)).resolves.toEqual(oldChat)
  })

  it('skips an unchanged update after one deterministic comparison', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const chat: ChatConversation = {
      id,
      title: 'Existing',
      messages: [{ role: 'assistant', id: 'answer', content: 'done' }],
      createdAt: 1,
      updatedAt: 10,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const fileName = (
      chatManager as unknown as {
        generateFileName: (value: ChatConversation) => string
      }
    ).generateFileName(chat)
    mockAdapter.list.mockResolvedValue({
      files: [`.aider_json_db/chats/${fileName}`],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))

    await expect(
      chatManager.updateChat(id, {
        messages: [{ content: 'done', id: 'answer', role: 'assistant' }],
      }),
    ).resolves.toEqual(chat)

    expect(mockAdapter.read).toHaveBeenCalledTimes(1)
    expect(mockAdapter.write).not.toHaveBeenCalled()
    expect(mockAdapter.rename).not.toHaveBeenCalled()
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

  it('rejects caller IDs that are ambiguous in the filename grammar', async () => {
    mockAdapter.exists.mockImplementation(async (filePath: string) =>
      filePath.endsWith('/chats'),
    )

    await expect(
      chatManager.createChat({ id: 'legacy_123_chat', messages: [] }),
    ).rejects.toThrow('Invalid chat ID')
    await expect(
      chatManager.importChat({
        id: '123_chat',
        title: 'Imported',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    ).rejects.toThrow('Invalid chat ID')
    expect(mockAdapter.write).not.toHaveBeenCalled()
  })

  it('recovers an existing ambiguous ID for list, find, update, and delete', async () => {
    const id = 'legacy_123_chat'
    const chat: ChatConversation = {
      id,
      title: 'Legacy',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const fileName = `v${CHAT_SCHEMA_VERSION}_Legacy_1_${id}.json`
    const filePath = `.aider_json_db/chats/${fileName}`
    const existingPaths = new Set([filePath])
    mockAdapter.list.mockResolvedValue({ files: [filePath], folders: [] })
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))
    mockAdapter.exists.mockImplementation(
      async (candidate: string) =>
        candidate.endsWith('/chats') || existingPaths.has(candidate),
    )
    mockAdapter.rename.mockImplementation(
      async (_source: string, destination: string) => {
        existingPaths.add(destination)
      },
    )
    mockAdapter.remove.mockImplementation(async (candidate: string) => {
      existingPaths.delete(candidate)
    })

    await expect(chatManager.listChats()).resolves.toEqual([
      {
        id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        schemaVersion: CHAT_SCHEMA_VERSION,
      },
    ])
    await expect(chatManager.findById(id)).resolves.toEqual(chat)

    jest.spyOn(Date, 'now').mockReturnValue(2)
    const updated = await chatManager.updateChat(id, { title: 'Updated' })
    expect(updated).toEqual({ ...chat, title: 'Updated', updatedAt: 2 })
    const updatedFileName = `v${CHAT_SCHEMA_VERSION}_Updated_2_${id}.json`
    const updatedFilePath = `.aider_json_db/chats/${updatedFileName}`
    expect(mockAdapter.rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\.aider_json_db\/chats\/\.aider-.+\.tmp$/),
      updatedFilePath,
    )
    expect(mockAdapter.remove).toHaveBeenCalledWith(filePath)

    mockAdapter.list.mockResolvedValue({
      files: [updatedFilePath],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(updated))
    await expect(chatManager.deleteChat(id)).resolves.toBe(true)
    expect(mockAdapter.remove).toHaveBeenCalledWith(updatedFilePath)
  })

  it('accepts and migrates a pre-asterisk-encoding filename on update', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const chat: ChatConversation = {
      id,
      title: '**Legacy**',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const legacyFileName = `v${CHAT_SCHEMA_VERSION}_**Legacy**_1_${id}.json`
    const legacyFilePath = `.aider_json_db/chats/${legacyFileName}`
    mockAdapter.list.mockResolvedValue({
      files: [legacyFilePath],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(chat))
    mockAdapter.exists.mockImplementation(
      async (candidate: string) =>
        candidate.endsWith('/chats') || candidate === legacyFilePath,
    )

    await expect(chatManager.findById(id)).resolves.toEqual(chat)

    jest.spyOn(Date, 'now').mockReturnValue(2)
    await expect(
      chatManager.updateChat(id, { messages: chat.messages }),
    ).resolves.toEqual(chat)
    const updated = await chatManager.updateChat(id, { title: '**Current**' })
    expect(updated?.updatedAt).toBe(2)
    expect(mockAdapter.rename).toHaveBeenCalledWith(
      expect.any(String),
      `.aider_json_db/chats/v${CHAT_SCHEMA_VERSION}_%2A%2ACurrent%2A%2A_2_${id}.json`,
    )
    expect(mockAdapter.remove).toHaveBeenCalledWith(legacyFilePath)
  })

  it('deletes parseable copies even when their rows are invalid', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const fileName = `v${CHAT_SCHEMA_VERSION}_Broken_1_${id}.json`
    const filePath = `.aider_json_db/chats/${fileName}`
    mockAdapter.list.mockResolvedValue({ files: [filePath], folders: [] })
    mockAdapter.read.mockResolvedValue('{broken')

    await expect(chatManager.deleteChat(id)).resolves.toBe(true)
    expect(mockAdapter.remove).toHaveBeenCalledWith(filePath)
  })

  it('validates chat files sequentially', async () => {
    const chats: ChatConversation[] = [
      {
        id: 'first-chat',
        title: 'First',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: CHAT_SCHEMA_VERSION,
      },
      {
        id: 'second-chat',
        title: 'Second',
        messages: [],
        createdAt: 2,
        updatedAt: 2,
        schemaVersion: CHAT_SCHEMA_VERSION,
      },
    ]
    const fileMethods = chatManager as unknown as {
      generateFileName: (value: ChatConversation) => string
    }
    const fileNames = chats.map((chat) => fileMethods.generateFileName(chat))
    mockAdapter.list.mockResolvedValue({
      files: fileNames.map((fileName) => `.aider_json_db/chats/${fileName}`),
      folders: [],
    })
    let activeReads = 0
    let maximumActiveReads = 0
    mockAdapter.read.mockImplementation(async (filePath: string) => {
      activeReads += 1
      maximumActiveReads = Math.max(maximumActiveReads, activeReads)
      await Promise.resolve()
      activeReads -= 1
      return JSON.stringify(chats[filePath.endsWith(fileNames[0]) ? 0 : 1])
    })

    await chatManager.listChats()
    expect(maximumActiveReads).toBe(1)
  })

  it('encodes Windows-reserved asterisks in generated filenames', () => {
    const chat: ChatConversation = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      title: '**Markdown title**',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const fileMethods = chatManager as unknown as {
      generateFileName: (value: ChatConversation) => string
      parseFileName: (value: string) => { title: string } | null
    }
    const fileName = fileMethods.generateFileName(chat)

    expect(fileName).not.toContain('*')
    expect(fileMethods.parseFileName(fileName)?.title).toBe(chat.title)
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

  it('reads only filename candidates for non-ambiguous chat IDs', async () => {
    const target: ChatConversation = {
      id: 'target-chat',
      title: 'Target',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    const other: ChatConversation = {
      ...target,
      id: 'other-chat',
      title: 'Other',
    }
    const fileMethods = chatManager as unknown as {
      generateFileName: (chat: ChatConversation) => string
    }
    const targetFile = fileMethods.generateFileName(target)
    const otherFile = fileMethods.generateFileName(other)
    mockAdapter.list.mockResolvedValue({
      files: [
        `.aider_json_db/chats/${targetFile}`,
        `.aider_json_db/chats/${otherFile}`,
      ],
      folders: [],
    })
    mockAdapter.read.mockResolvedValue(JSON.stringify(target))

    await expect(chatManager.findById(target.id)).resolves.toEqual(target)

    expect(mockAdapter.read).toHaveBeenCalledTimes(1)
    expect(mockAdapter.read).toHaveBeenCalledWith(
      `.aider_json_db/chats/${targetFile}`,
    )
  })

  it('accepts stored legacy agent-command messages for normalization', async () => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({
        id: 'legacy-agent-chat',
        title: 'Legacy agent run',
        messages: [
          {
            id: 'command-1',
            role: 'agent-command',
            command: 'git status',
            output: 'clean',
            exitCode: 0,
            status: 'success',
          },
        ],
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }),
    )

    await expect(chatManager.read('legacy.json')).resolves.toMatchObject({
      messages: [
        {
          title: 'git status',
          detail: '',
          input: 'git status',
          kind: 'command',
        },
      ],
    })
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

  it.each([
    [
      'invalid editor state',
      {
        id: 'message-id',
        role: 'user',
        content: {},
        promptContent: null,
        mentionables: [],
      },
    ],
    [
      'invalid annotation',
      {
        id: 'message-id',
        role: 'assistant',
        content: 'answer',
        annotations: [null],
      },
    ],
    [
      'invalid similarity results',
      {
        id: 'message-id',
        role: 'user',
        content: null,
        promptContent: null,
        mentionables: [],
        similaritySearchResults: 'not-an-array',
      },
    ],
  ])('rejects a stored message with %s', async (_case, message) => {
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({
        id: 'valid-id',
        title: 'Broken chat',
        messages: [message],
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: CHAT_SCHEMA_VERSION,
      }),
    )

    await expect(chatManager.read('chat.json')).resolves.toBeNull()
  })
})
