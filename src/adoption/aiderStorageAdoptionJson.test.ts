import {
  REDACTED_ADOPTION_ERROR,
  adoptAiderStorage,
  summarizeAdoptionError,
} from './aiderStorageAdoption'
import {
  createTestApp,
  decodeText,
  encodeText,
  jsonFile,
} from './aiderStorageAdoption.test-support'

describe('Aider JSON storage adoption', () => {
  it('preserves existing Aider JSON records when legacy JSON has the same record id', async () => {
    const app = createTestApp()

    await app.vault.adapter.mkdir('.smtcmp_json_db/chats')
    await app.vault.adapter.write(
      '.smtcmp_json_db/chats/v1_Legacy_20_shared-chat.json',
      jsonFile({
        id: 'shared-chat',
        title: 'Legacy',
        messages: [],
        createdAt: 10,
        updatedAt: 20,
        schemaVersion: 1,
      }),
    )

    await app.vault.adapter.mkdir('.aider_json_db/chats')
    await app.vault.adapter.write(
      '.aider_json_db/chats/v1_Aider_30_shared-chat.json',
      jsonFile({
        id: 'shared-chat',
        title: 'Aider',
        messages: [],
        createdAt: 30,
        updatedAt: 30,
        schemaVersion: 1,
      }),
    )

    await adoptAiderStorage(app)

    const adoptedFiles = await app.vault.adapter.list('.aider_json_db/chats')
    expect(adoptedFiles.files).toEqual([
      '.aider_json_db/chats/v1_Aider_30_shared-chat.json',
    ])
    expect(
      await app.vault.adapter.read(
        '.aider_json_db/chats/v1_Aider_30_shared-chat.json',
      ),
    ).toContain('"title": "Aider"')
  })

  it('preserves existing Aider templates when legacy JSON has the same template name', async () => {
    const app = createTestApp()

    await app.vault.adapter.mkdir('.smtcmp_json_db/templates')
    await app.vault.adapter.write(
      '.smtcmp_json_db/templates/v1_Shared_20_legacy-template.json',
      jsonFile({
        id: 'legacy-template',
        name: 'Shared',
        content: { nodes: [] },
        createdAt: 10,
        updatedAt: 20,
        schemaVersion: 1,
      }),
    )

    await app.vault.adapter.mkdir('.aider_json_db/templates')
    await app.vault.adapter.write(
      '.aider_json_db/templates/v1_Shared_30_aider-template.json',
      jsonFile({
        id: 'aider-template',
        name: 'Shared',
        content: { nodes: [] },
        createdAt: 30,
        updatedAt: 30,
        schemaVersion: 1,
      }),
    )

    await adoptAiderStorage(app)

    const adoptedFiles = await app.vault.adapter.list(
      '.aider_json_db/templates',
    )
    expect(adoptedFiles.files).toEqual([
      '.aider_json_db/templates/v1_Shared_30_aider-template.json',
    ])
    expect(
      await app.vault.adapter.read(
        '.aider_json_db/templates/v1_Shared_30_aider-template.json',
      ),
    ).toContain('"id": "aider-template"')
  })

  it('continues adopting valid legacy JSON files when one legacy JSON file is malformed', async () => {
    const app = createTestApp()

    await app.vault.adapter.mkdir('.smtcmp_json_db/chats')
    await app.vault.adapter.write(
      '.smtcmp_json_db/chats/v1_Broken_10_broken-chat.json',
      '{',
    )
    await app.vault.adapter.write(
      '.smtcmp_json_db/chats/v1_Valid_20_valid-chat.json',
      jsonFile({
        id: 'valid-chat',
        title: 'Valid',
        messages: [],
        createdAt: 10,
        updatedAt: 20,
        schemaVersion: 1,
      }),
    )

    await adoptAiderStorage(app)

    expect(
      await app.vault.adapter.exists(
        '.aider_json_db/chats/v1_Valid_20_valid-chat.json',
      ),
    ).toBe(true)
    expect(
      await app.vault.adapter.exists(
        '.aider_json_db/chats/v1_Broken_10_broken-chat.json',
      ),
    ).toBe(false)
  })

  it('records a resource failure and continues adopting later resources', async () => {
    const app = createTestApp()

    await app.vault.adapter.mkdir('.smtcmp_json_db/chats')
    await app.vault.adapter.write(
      '.smtcmp_json_db/chats/v1_Legacy_10_legacy-chat.json',
      jsonFile({
        id: 'legacy-chat',
        title: 'Legacy',
        messages: [],
        createdAt: 10,
        updatedAt: 10,
        schemaVersion: 1,
      }),
    )
    await app.vault.adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      encodeText('legacy-vector'),
    )
    app.vault.adapter.failLists(new Error('list failed'))

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.jsonDb).toMatchObject({
      status: 'failed',
      sourcePath: '.smtcmp_json_db',
      targetPath: '.aider_json_db',
      lastError: REDACTED_ADOPTION_ERROR,
    })
    expect(marker.resources.vectorDb?.status).toBe('completed')
    expect(marker.resources.secrets?.status).toBe('completed')
    expect(
      decodeText(await app.vault.adapter.readBinary('.aider_vector_db.tar.gz')),
    ).toBe('legacy-vector')
  })

  it('redacts token-shaped adoption errors before writing the marker', async () => {
    const app = createTestApp()
    const secretLikeValue = 'sk-test-secret-token'

    await app.vault.adapter.mkdir('.smtcmp_json_db/chats')
    app.vault.adapter.failLists(
      new Error(`failed with apiKey=${secretLikeValue}`),
    )

    const marker = await adoptAiderStorage(app)

    expect(marker.resources.jsonDb?.lastError).toBe(REDACTED_ADOPTION_ERROR)
    expect(marker.resources.jsonDb?.lastError).not.toContain(secretLikeValue)
  })

  it('redacts token-shaped adoption errors before console reporting', () => {
    const secretLikeValue = 'sk-test-console-token'

    const summary = summarizeAdoptionError(
      new Error(`failed with accessToken=${secretLikeValue}`),
    )

    expect(summary).toBe(REDACTED_ADOPTION_ERROR)
    expect(summary).not.toContain(secretLikeValue)
  })
})
