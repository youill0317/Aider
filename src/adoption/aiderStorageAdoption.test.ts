import { MAX_PGLITE_DATABASE_BYTES, PGLITE_DB_PATH } from '../constants'
import { ROOT_DIR } from '../database/json/constants'
import { CHAT_HISTORY_DIR } from '../utils/chat/chatHistoryManager'

import { adoptAiderStorage } from './aiderStorageAdoption'
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
