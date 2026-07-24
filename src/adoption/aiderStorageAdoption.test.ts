import { MAX_PGLITE_DATABASE_BYTES, PGLITE_DB_PATH } from '../constants'
import { ROOT_DIR } from '../database/json/constants'
import { CHAT_HISTORY_DIR } from '../utils/chat/chatHistoryManager'

import {
  MAX_ADOPTION_DIRECTORY_DEPTH,
  MAX_ADOPTION_JSON_FILE_BYTES,
} from './aiderAdoptionUtils'
import {
  adoptAiderStorage,
  adoptAiderVectorStorage,
} from './aiderStorageAdoption'
import {
  createTestApp,
  decodeText,
  encodeText,
  jsonFile,
} from './aiderStorageAdoption.test-support'

describe('Aider storage adoption', () => {
  it('copies legacy Smart Composer plugin data before settings are loaded', async () => {
    const app = createTestApp()
    const legacyPluginDataPath = '.obsidian/plugins/smart-composer/data.json'
    const aiderPluginDataPath = '.obsidian/plugins/aider/data.json'

    await app.vault.adapter.mkdir('.obsidian')
    await app.vault.adapter.mkdir('.obsidian/plugins')
    await app.vault.adapter.mkdir('.obsidian/plugins/smart-composer')
    await app.vault.adapter.write(
      legacyPluginDataPath,
      jsonFile({ version: 20, providers: [] }),
    )

    const marker = await adoptAiderStorage(app)

    expect(await app.vault.adapter.read(aiderPluginDataPath)).toBe(
      await app.vault.adapter.read(legacyPluginDataPath),
    )
    expect(await app.vault.adapter.exists(legacyPluginDataPath)).toBe(true)
    expect(marker.resources.pluginData?.status).toBe('completed')
  })

  it('rejects non-object legacy plugin settings', async () => {
    const app = createTestApp()
    const legacyPath = '.obsidian/plugins/smart-composer/data.json'
    await app.vault.adapter.mkdir('.obsidian/plugins/smart-composer')
    await app.vault.adapter.write(legacyPath, '[]')

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.pluginData?.status).toBe('failed')
    expect(
      await app.vault.adapter.exists('.obsidian/plugins/aider/data.json'),
    ).toBe(false)
  })

  it('rejects oversized plugin settings before reading them', async () => {
    const app = createTestApp()
    const adapter = app.vault.adapter
    const legacyPath = '.obsidian/plugins/smart-composer/data.json'
    await adapter.mkdir('.obsidian/plugins/smart-composer')
    await adapter.write(legacyPath, '{}')
    const read = jest.spyOn(adapter, 'read')
    const stat: typeof adapter.stat = adapter.stat.bind(adapter)
    jest
      .spyOn(adapter, 'stat')
      .mockImplementation(async (path: string) =>
        path === legacyPath
          ? { type: 'file', size: MAX_ADOPTION_JSON_FILE_BYTES + 1 }
          : stat(path),
      )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.pluginData?.status).toBe('failed')
    expect(read).not.toHaveBeenCalledWith(legacyPath)
    expect(await adapter.exists('.obsidian/plugins/aider/data.json')).toBe(
      false,
    )
  })

  it('bounds recursive legacy JSON directory traversal', async () => {
    const app = createTestApp()
    const nestedPath = Array.from(
      { length: MAX_ADOPTION_DIRECTORY_DEPTH + 2 },
      (_, index) => `level-${index}`,
    ).join('/')
    await app.vault.adapter.mkdir(`.smtcmp_json_db/${nestedPath}`)

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.jsonDb?.status).toBe('failed')
  })

  it('fails legacy chat adoption when a list entry is incomplete', async () => {
    const app = createTestApp()
    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([{ id: 'missing-metadata' }]),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.legacyChatHistories?.status).toBe('failed')
    expect(
      await app.vault.adapter.exists('.aider_chat_histories/chat_list.json'),
    ).toBe(false)
  })

  it('retries adoption after a partial temporary write', async () => {
    const app = createTestApp()
    const adapter = app.vault.adapter
    const legacyPath = '.obsidian/plugins/smart-composer/data.json'
    const targetPath = '.obsidian/plugins/aider/data.json'
    await adapter.mkdir('.obsidian/plugins/smart-composer')
    await adapter.write(legacyPath, jsonFile({ version: 20, providers: [] }))
    const write = adapter.write.bind(adapter)
    jest.spyOn(adapter, 'write').mockImplementationOnce(async (path) => {
      await write(path, '{')
      throw new Error('disk full')
    })

    const first = await adoptAiderStorage(app)

    expect(first.resources.pluginData?.status).toBe('failed')
    expect(await adapter.exists(targetPath)).toBe(false)

    const second = await adoptAiderStorage(app)
    expect(second.resources.pluginData?.status).toBe('completed')
    expect(await adapter.read(targetPath)).toBe(await adapter.read(legacyPath))
  })

  it('keeps existing Aider plugin data when legacy plugin data also exists', async () => {
    const app = createTestApp()

    await app.vault.adapter.mkdir('.obsidian')
    await app.vault.adapter.mkdir('.obsidian/plugins')
    await app.vault.adapter.mkdir('.obsidian/plugins/smart-composer')
    await app.vault.adapter.mkdir('.obsidian/plugins/aider')
    await app.vault.adapter.write(
      '.obsidian/plugins/smart-composer/data.json',
      jsonFile({ version: 20, providers: [{ id: 'legacy' }] }),
    )
    await app.vault.adapter.write(
      '.obsidian/plugins/aider/data.json',
      jsonFile({ version: 20, providers: [{ id: 'aider' }] }),
    )

    const marker = await adoptAiderStorage(app)

    expect(
      await app.vault.adapter.read('.obsidian/plugins/aider/data.json'),
    ).toContain('"id": "aider"')
    expect(marker.resources.pluginData?.status).toBe(
      'skipped-existing-aider-data',
    )
  })

  it('retries a missing legacy resource when it appears later', async () => {
    const app = createTestApp()
    const legacyPath = '.obsidian/plugins/smart-composer/data.json'
    const targetPath = '.obsidian/plugins/aider/data.json'

    expect((await adoptAiderStorage(app)).resources.pluginData?.status).toBe(
      'skipped-missing-legacy-data',
    )

    await app.vault.adapter.mkdir('.obsidian/plugins/smart-composer')
    await app.vault.adapter.write(
      legacyPath,
      jsonFile({ version: 20, providers: [] }),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.pluginData?.status).toBe('completed')
    expect(await app.vault.adapter.read(targetPath)).toBe(
      await app.vault.adapter.read(legacyPath),
    )
  })

  it('does not create fake secret adoption and preserves historic markers', async () => {
    const app = createTestApp()

    expect((await adoptAiderStorage(app)).resources.secrets).toBeUndefined()

    const historicSecretStatus = {
      status: 'completed',
      sourcePath: 'smart-composer-provider-*',
      targetPath: 'aider-provider-*',
      completedAt: '2025-01-01T00:00:00.000Z',
    }
    await app.vault.adapter.write(
      '.obsidian/plugins/aider/.aider_adoption.json',
      jsonFile({ resources: { secrets: historicSecretStatus } }),
    )

    expect((await adoptAiderStorage(app)).resources.secrets).toEqual(
      historicSecretStatus,
    )
  })

  it('uses canonical Aider storage constants when legacy Smart Composer constants still exist', () => {
    expect(ROOT_DIR).toBe('.aider_json_db')
    expect(PGLITE_DB_PATH).toBe('.aider_vector_db.tar.gz')
    expect(CHAT_HISTORY_DIR).toBe('.aider_chat_histories')
  })

  it('copies legacy vector storage only when Aider vector storage is missing', async () => {
    const app = createTestApp()

    await app.vault.adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      encodeText('legacy-vector'),
    )
    await adoptAiderStorage(app)
    expect(
      decodeText(await app.vault.adapter.readBinary('.aider_vector_db.tar.gz')),
    ).toBe('legacy-vector')
    expect(await app.vault.adapter.exists('.smtcmp_vector_db.tar.gz')).toBe(
      true,
    )

    await app.vault.adapter.writeBinary(
      '.aider_vector_db.tar.gz',
      encodeText('aider-vector'),
    )
    await adoptAiderStorage(app)
    expect(
      decodeText(await app.vault.adapter.readBinary('.aider_vector_db.tar.gz')),
    ).toBe('aider-vector')
  })

  it('can defer vector adoption until after the main plugin wiring', async () => {
    const app = createTestApp()
    await app.vault.adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      encodeText('legacy-vector'),
    )

    const initialMarker = await adoptAiderStorage(app, {
      includeVectorDb: false,
    })
    expect(initialMarker.resources.vectorDb).toBeUndefined()
    expect(await app.vault.adapter.exists(PGLITE_DB_PATH)).toBe(false)

    const vectorMarker = await adoptAiderVectorStorage(app)
    expect(vectorMarker.resources.vectorDb?.status).toBe('completed')
    expect(decodeText(await app.vault.adapter.readBinary(PGLITE_DB_PATH))).toBe(
      'legacy-vector',
    )
  })

  it('rejects an oversized legacy vector archive before reading it', async () => {
    const app = createTestApp()
    const readBinary = jest.spyOn(app.vault.adapter, 'readBinary')
    jest.spyOn(app.vault.adapter, 'stat').mockResolvedValue({
      type: 'file',
      size: MAX_PGLITE_DATABASE_BYTES + 1,
    })
    await app.vault.adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      encodeText('oversized'),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.vectorDb?.status).toBe('failed')
    expect(readBinary).not.toHaveBeenCalled()
    expect(await app.vault.adapter.exists(PGLITE_DB_PATH)).toBe(false)
  })

  it('rechecks the legacy vector size after reading it', async () => {
    const app = createTestApp()
    const adapter = app.vault.adapter
    await adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      encodeText('small-before-read'),
    )
    jest
      .spyOn(adapter, 'stat')
      .mockImplementation(async (path) =>
        path === '.smtcmp_vector_db.tar.gz' ? { type: 'file', size: 1 } : null,
      )
    jest.spyOn(adapter, 'readBinary').mockResolvedValueOnce({
      byteLength: MAX_PGLITE_DATABASE_BYTES + 1,
    } as ArrayBuffer)

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.vectorDb?.status).toBe('failed')
    expect(await adapter.exists(PGLITE_DB_PATH)).toBe(false)
  })

  it('keeps legacy chat histories after adopting missing Aider chat histories', async () => {
    const app = createTestApp()
    const chat = {
      schemaVersion: 3,
      id: 'legacy-chat',
      title: 'Legacy chat',
      createdAt: 10,
      updatedAt: 20,
      messages: [],
    }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([
        {
          schemaVersion: chat.schemaVersion,
          id: chat.id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        },
      ]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/legacy-chat.json',
      jsonFile(chat),
    )

    await adoptAiderStorage(app)

    expect(
      await app.vault.adapter.exists('.smtcmp_chat_histories/chat_list.json'),
    ).toBe(true)
    expect(
      await app.vault.adapter.exists('.smtcmp_chat_histories/legacy-chat.json'),
    ).toBe(true)
    expect(
      await app.vault.adapter.exists('.aider_chat_histories/legacy-chat.json'),
    ).toBe(true)
  })

  it('continues adopting valid legacy chat histories when one legacy chat file is missing', async () => {
    const app = createTestApp()
    const validChatMeta = {
      schemaVersion: 3,
      id: 'valid-chat',
      title: 'Valid chat',
      createdAt: 20,
      updatedAt: 30,
    }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([
        {
          schemaVersion: 3,
          id: 'missing-chat',
          title: 'Missing chat',
          createdAt: 10,
          updatedAt: 20,
        },
        validChatMeta,
      ]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/valid-chat.json',
      jsonFile({ ...validChatMeta, messages: [] }),
    )

    const marker = await adoptAiderStorage(app)

    expect(
      await app.vault.adapter.exists('.aider_chat_histories/valid-chat.json'),
    ).toBe(true)
    expect(marker.resources.legacyChatHistories).toMatchObject({
      status: 'failed',
      sourcePath: '.smtcmp_chat_histories',
      targetPath: '.aider_chat_histories',
    })
  })

  it('repairs a listed canonical chat whose conversation is malformed', async () => {
    const app = createTestApp()
    const chatMeta = {
      schemaVersion: 3,
      id: 'legacy-chat',
      title: 'Legacy chat',
      createdAt: 10,
      updatedAt: 20,
    }
    const legacyChat = { ...chatMeta, messages: [] }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([chatMeta]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/legacy-chat.json',
      jsonFile(legacyChat),
    )
    await app.vault.adapter.mkdir('.aider_chat_histories')
    await app.vault.adapter.write(
      '.aider_chat_histories/chat_list.json',
      jsonFile([chatMeta]),
    )
    await app.vault.adapter.write(
      '.aider_chat_histories/legacy-chat.json',
      jsonFile(chatMeta),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.legacyChatHistories?.status).toBe('completed')
    expect(
      await app.vault.adapter.read('.aider_chat_histories/legacy-chat.json'),
    ).toBe(jsonFile(legacyChat))
  })

  it('preserves a malformed canonical chat list instead of overwriting it', async () => {
    const app = createTestApp()
    const chatMeta = {
      schemaVersion: 3,
      id: 'legacy-chat',
      title: 'Legacy chat',
      createdAt: 10,
      updatedAt: 20,
    }
    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([chatMeta]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/legacy-chat.json',
      jsonFile({ ...chatMeta, messages: [] }),
    )
    await app.vault.adapter.mkdir('.aider_chat_histories')
    await app.vault.adapter.write(
      '.aider_chat_histories/chat_list.json',
      '{malformed',
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.legacyChatHistories?.status).toBe('failed')
    expect(
      await app.vault.adapter.read('.aider_chat_histories/chat_list.json'),
    ).toBe('{malformed')
    expect(
      await app.vault.adapter.exists('.aider_chat_histories/legacy-chat.json'),
    ).toBe(false)
  })

  it('does not adopt a legacy chat with only valid metadata', async () => {
    const app = createTestApp()
    const chatMeta = {
      schemaVersion: 3,
      id: 'metadata-only-chat',
      title: 'Metadata only',
      createdAt: 10,
      updatedAt: 20,
    }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([chatMeta]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/metadata-only-chat.json',
      jsonFile(chatMeta),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.legacyChatHistories?.status).toBe('failed')
    expect(
      await app.vault.adapter.exists(
        '.aider_chat_histories/metadata-only-chat.json',
      ),
    ).toBe(false)
  })

  it('skips legacy chat histories with unsafe ids before reading paths', async () => {
    // Given: a legacy chat list contains one path-traversal id and one valid id.
    const app = createTestApp()
    const unsafeChatMeta = {
      schemaVersion: 3,
      id: '../escaped',
      title: 'Unsafe chat',
      createdAt: 10,
      updatedAt: 20,
    }
    const validChatMeta = {
      schemaVersion: 3,
      id: 'valid_chat-1',
      title: 'Valid chat',
      createdAt: 20,
      updatedAt: 30,
    }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([unsafeChatMeta, validChatMeta]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/../escaped.json',
      jsonFile({ ...unsafeChatMeta, messages: [] }),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/valid_chat-1.json',
      jsonFile({ ...validChatMeta, messages: [] }),
    )

    // When: legacy chat history adoption runs.
    const marker = await adoptAiderStorage(app)

    // Then: the unsafe id is treated as malformed without copying its file.
    expect(
      await app.vault.adapter.exists('.aider_chat_histories/../escaped.json'),
    ).toBe(false)
    expect(
      await app.vault.adapter.exists('.aider_chat_histories/valid_chat-1.json'),
    ).toBe(true)
    expect(marker.resources.legacyChatHistories).toMatchObject({
      status: 'failed',
      sourcePath: '.smtcmp_chat_histories',
      targetPath: '.aider_chat_histories',
    })
  })

  it('does not duplicate chat history entries when adoption is repeated', async () => {
    const app = createTestApp()
    const chatMeta = {
      schemaVersion: 3,
      id: 'legacy-chat',
      title: 'Legacy chat',
      createdAt: 10,
      updatedAt: 20,
    }

    await app.vault.adapter.mkdir('.smtcmp_chat_histories')
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/chat_list.json',
      jsonFile([chatMeta]),
    )
    await app.vault.adapter.write(
      '.smtcmp_chat_histories/legacy-chat.json',
      jsonFile({ ...chatMeta, messages: [] }),
    )

    await adoptAiderStorage(app)
    await adoptAiderStorage(app)

    const adoptedList = JSON.parse(
      await app.vault.adapter.read('.aider_chat_histories/chat_list.json'),
    ) as { readonly id: string }[]
    expect(adoptedList).toHaveLength(1)
    expect(adoptedList[0]?.id).toBe('legacy-chat')
  })
})
