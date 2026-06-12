import { createSecretStore } from '../../security/secret-store/secret-store'
import {
  hydrateSettingsSecrets,
  sanitizeSettingsForPersistence,
} from '../../security/secret-store/settings-secrets'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { SmartComposerSettings } from './setting.types'

describe('secret migration compatibility', () => {
  it('migrates old api key settings without visible UX change', async () => {
    // Given: old persisted settings still contain a raw API key.
    const settings = createOldSettings()
    const secretStore = createObsidianSecretStore()

    // When: settings are saved through the secret boundary.
    const persisted = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const hydrated = await hydrateSettingsSecrets(persisted, secretStore)

    // Then: persisted data is sanitized while runtime settings remain usable.
    expect(JSON.stringify(persisted)).not.toContain('sk-old-api-key')
    expect(hydrated.providers[0]).toMatchObject({
      id: 'openai',
      type: 'openai',
      apiKey: 'sk-old-api-key',
    })
  })

  it('migrates old OAuth settings without losing connection', async () => {
    // Given: old persisted settings still contain OAuth tokens.
    const settings = createOldSettings()
    const secretStore = createObsidianSecretStore()

    // When: settings are saved and hydrated.
    const persisted = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const hydrated = await hydrateSettingsSecrets(persisted, secretStore)
    const provider = hydrated.providers[1]

    // Then: persisted data is sanitized while connection state is preserved.
    expect(JSON.stringify(persisted)).not.toContain('old-refresh-token')
    expect(provider.type).toBe('openai-plan')
    if (provider.type === 'openai-plan') {
      expect(provider.oauth).toMatchObject({
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        accountId: 'account-id',
      })
    }
  })

  it('repeated migration is idempotent', async () => {
    // Given: old settings are migrated once.
    const settings = createOldSettings()
    const secretStore = createObsidianSecretStore()
    const firstPersisted = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // When: the sanitized settings are migrated again.
    const secondPersisted = await sanitizeSettingsForPersistence(
      firstPersisted,
      secretStore,
    )

    // Then: the persisted shape remains stable.
    expect(secondPersisted).toEqual(firstPersisted)
  })

  it('secure-store write failure keeps raw secret recoverable', async () => {
    // Given: secure storage fails before the old raw API key can be moved.
    const settings = createOldSettings()
    const failingStore = {
      getBackendStatus: () => 'obsidian-secret-storage' as const,
      getSecret: async () => null,
      setSecret: async () => {
        throw new Error('write failed')
      },
      deleteSecret: async () => undefined,
    }

    // When: migration attempts to sanitize settings.
    const persisted = await sanitizeSettingsForPersistence(
      settings,
      failingStore,
    )

    // Then: ordinary settings keep the raw secret rather than losing credentials.
    expect(persisted.providers[0]).toMatchObject({
      apiKey: 'sk-old-api-key',
    })
  })

  it('secure-store read failure reports bounded reconnect state', async () => {
    // Given: persisted settings are sanitized but secure storage cannot read.
    const settings = createOldSettings()
    const secretStore = createObsidianSecretStore()
    const persisted = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const failingReadStore = {
      getBackendStatus: () => 'obsidian-secret-storage' as const,
      getSecret: async () => {
        throw new Error('read failed')
      },
      setSecret: async () => undefined,
      deleteSecret: async () => undefined,
    }

    // When: runtime hydration sees the read failure.
    const hydrated = await hydrateSettingsSecrets(persisted, failingReadStore)

    // Then: hydration returns bounded missing-credential state, not raw secrets.
    expect(JSON.stringify(hydrated)).not.toContain('old-refresh-token')
    expect(hydrated.providers[0]).not.toHaveProperty('apiKey')
  })
})

function createObsidianSecretStore() {
  const secretStorageValues = new Map<string, string>()
  return createSecretStore({
    app: {
      secretStorage: {
        getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
        setSecret: async (key: string, value: string) => {
          secretStorageValues.set(key, value)
        },
      },
    },
  })
}

function createOldSettings(): SmartComposerSettings {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    providers: [
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-old-api-key',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          expiresAt: 1_893_456_000_000,
          accountId: 'account-id',
        },
      },
    ],
    chatModels: [],
    embeddingModels: [],
    chatModelId: '',
    applyModelId: '',
    embeddingModelId: '',
    systemPrompt: '',
    ragOptions: {
      chunkSize: 1000,
      thresholdTokens: 8192,
      minSimilarity: 0,
      limit: 10,
      excludePatterns: [],
      includePatterns: [],
    },
    mcp: {
      servers: [],
    },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
  }
}
