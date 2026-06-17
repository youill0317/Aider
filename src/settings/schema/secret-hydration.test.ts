import {
  createSecretStore,
  createSecretStoreKey,
} from '../../security/secret-store/secret-store'
import {
  hydrateSettingsSecrets,
  sanitizeSettingsForPersistence,
} from '../../security/secret-store/settings-secrets'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { SmartComposerSettings } from './setting.types'

function createTestSettings(): SmartComposerSettings {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    providers: [
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-test-openai-secret',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
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
    agent: {
      codex: {
        enabled: true,
        command: 'codex',
        defaultSandbox: 'workspace-write',
        approvalPolicy: 'default',
        cwdMode: 'vault',
        customCwd: '',
        resume: true,
      },
    },
  }
}

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

describe('settings secret hydration boundary', () => {
  it('persists provider settings without raw api keys', async () => {
    // Given: runtime settings contain an API key for existing consumers.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()

    // When: settings cross the persistence boundary.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // Then: ordinary persisted settings no longer contain the raw API key.
    expect(JSON.stringify(persistedSettings)).not.toContain(
      'sk-test-openai-secret',
    )
    expect(persistedSettings.providers[0].apiKey).toBeUndefined()
  })

  it('save boundary strips raw secrets on every save', async () => {
    // Given: the same runtime settings are saved more than once.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()

    // When: the persistence boundary runs repeatedly.
    const firstPersistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const secondPersistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // Then: no save reintroduces raw provider or OAuth secrets.
    expect(JSON.stringify(firstPersistedSettings)).not.toContain(
      'sk-test-openai-secret',
    )
    expect(JSON.stringify(secondPersistedSettings)).not.toContain(
      'test-access-token',
    )
    expect(JSON.stringify(secondPersistedSettings)).not.toContain(
      'test-refresh-token',
    )
  })

  it('hydrates api keys for runtime consumers', async () => {
    // Given: persisted settings contain no raw API key after a prior save.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // When: settings are hydrated for runtime consumers.
    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    // Then: existing provider consumers see the API key as before.
    expect(hydratedSettings.providers[0].apiKey).toBe('sk-test-openai-secret')
  })

  it('migrates OAuth refresh tokens into Obsidian secretStorage', async () => {
    // Given: a plan provider still has OAuth tokens in ordinary settings.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()

    // When: settings are sanitized for persistence.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // Then: token fields are placeholders and secret storage can hydrate them.
    expect(JSON.stringify(persistedSettings)).not.toContain(
      'test-refresh-token',
    )
    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )
    const planProvider = hydratedSettings.providers[1]
    expect(
      planProvider.type === 'openai-plan'
        ? planProvider.oauth?.refreshToken
        : undefined,
    ).toBe('test-refresh-token')
  })

  it('partial migration failure keeps failed secret recoverable', async () => {
    // Given: one provider secret write fails but other settings must survive.
    const settings = createTestSettings()
    const failingSecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage' as const,
      getSecret: async () => null,
      setSecret: async (key: string) => {
        if (
          key ===
          createSecretStoreKey({
            providerId: 'openai',
            providerType: 'openai',
            field: 'apiKey',
          })
        ) {
          throw new Error('write failed')
        }
      },
      deleteSecret: async () => undefined,
    }

    // When: settings are sanitized for persistence.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      failingSecretStore,
    )

    // Then: the failed provider remains recoverable and unrelated OAuth values are stripped.
    expect(persistedSettings.providers[0].apiKey).toBe('sk-test-openai-secret')
    expect(JSON.stringify(persistedSettings)).not.toContain('test-access-token')
    expect(JSON.stringify(persistedSettings)).not.toContain(
      'test-refresh-token',
    )
  })

  it('migration is idempotent', async () => {
    // Given: settings already passed through the secret boundary once.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()
    const firstPersistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // When: the same persisted shape crosses the boundary again.
    const secondPersistedSettings = await sanitizeSettingsForPersistence(
      firstPersistedSettings,
      secretStore,
    )

    // Then: the persisted representation remains stable.
    expect(secondPersistedSettings).toEqual(firstPersistedSettings)
    await expect(
      hydrateSettingsSecrets(secondPersistedSettings, secretStore),
    ).resolves.toMatchObject({
      providers: [
        {},
        {
          oauth: {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
          },
        },
      ],
    })
  })

  it('ordinary saves keep active provider secrets after sanitization', async () => {
    // Given: a provider secret has already been moved into secure storage.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()
    const firstPersistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // When: the same runtime settings are saved with previous hydrated settings.
    const secondPersistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
      settings,
    )
    const hydratedSettings = await hydrateSettingsSecrets(
      secondPersistedSettings,
      secretStore,
    )

    // Then: the secret remains available even though persisted settings stay sanitized.
    expect(secondPersistedSettings).toEqual(firstPersistedSettings)
    expect(secondPersistedSettings.providers[0].apiKey).toBeUndefined()
    expect(hydratedSettings.providers[0].apiKey).toBe('sk-test-openai-secret')
  })

  it('disconnect removes or tombstones secret-store entries', async () => {
    // Given: a connected provider has already stored its secret.
    const settings = createTestSettings()
    const secretStore = createObsidianSecretStore()
    await sanitizeSettingsForPersistence(settings, secretStore)
    const apiKeySecretId = createSecretStoreKey({
      providerId: 'openai',
      providerType: 'openai',
      field: 'apiKey',
    })

    // When: the provider is removed and settings are saved again.
    await sanitizeSettingsForPersistence(
      {
        ...settings,
        providers: settings.providers.slice(1),
      },
      secretStore,
      settings,
    )

    // Then: the provider secret is no longer available to hydration.
    await expect(secretStore.getSecret(apiKeySecretId)).resolves.toBeNull()
  })

  it('fallback persistence preserves current ordinary settings behavior', async () => {
    // Given: secure storage is unavailable in the current runtime.
    const settings = createTestSettings()
    const secretStore = createSecretStore({ app: {} })

    // When: settings cross the persistence boundary.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )

    // Then: fallback does not silently delete credentials it cannot persist securely.
    expect(secretStore.getBackendStatus()).toBe('insecure-settings-fallback')
    expect(persistedSettings.providers[0].apiKey).toBe('sk-test-openai-secret')
    expect(JSON.stringify(persistedSettings)).toContain('test-refresh-token')
  })
})
