import {
  createSecretStore,
  createSecretStoreKey,
} from '../../security/secret-store/secret-store'
import {
  hydrateSettingsSecrets,
  sanitizeSettingsForPersistence,
} from '../../security/secret-store/settings-secrets'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { LLMProvider } from '../../types/provider.types'

function createSecureSecretStore() {
  const secretStorageValues = new Map<string, string>()

  return createSecretStore({
    app: {
      secretStorage: {
        getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
        setSecret: async (key: string, value: string) => {
          secretStorageValues.set(key, value)
        },
        deleteSecret: async (key: string) => {
          secretStorageValues.delete(key)
        },
      },
    },
  })
}

function createSettings(providers: LLMProvider[]): SmartComposerSettings {
  return {
    version: 16,
    providers,
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

describe('provider secret flow', () => {
  it('provider form stores api key through secret boundary', async () => {
    // Given: provider form submission adds an API-key provider.
    const provider: LLMProvider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'sk-provider-form-secret',
    }
    const settings = createSettings([provider])
    const secretStore = createSecureSecretStore()

    // When: the settings save boundary persists the provider.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    // Then: ordinary settings are sanitized while runtime consumers still see the key.
    expect(JSON.stringify(persistedSettings)).not.toContain(
      'sk-provider-form-secret',
    )
    expect(hydratedSettings.providers[0].apiKey).toBe('sk-provider-form-secret')
  })

  it('OpenAI connect stores OAuth through secret boundary', async () => {
    // Given: OpenAI connect modal saves OAuth credentials through settings.
    const provider: LLMProvider = {
      id: 'openai-plan',
      type: 'openai-plan',
      oauth: {
        accessToken: 'openai-connect-access-token',
        refreshToken: 'openai-connect-refresh-token',
        expiresAt: 1_893_456_000_000,
        accountId: 'account-id',
      },
    }
    const settings = createSettings([provider])
    const secretStore = createSecureSecretStore()

    // When: the settings save boundary persists the connection.
    const persistedSettings = await sanitizeSettingsForPersistence(
      settings,
      secretStore,
    )
    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    // Then: ordinary settings are sanitized while the connection remains visible.
    expect(JSON.stringify(persistedSettings)).not.toContain(
      'openai-connect-refresh-token',
    )
    const hydratedProvider = hydratedSettings.providers[0]
    expect(
      hydratedProvider.type === 'openai-plan'
        ? hydratedProvider.oauth?.accessToken
        : undefined,
    ).toBe('openai-connect-access-token')
  })

  it('disconnect deletes OAuth secret', async () => {
    // Given: a connected plan provider has OAuth secrets in secure storage.
    const provider: LLMProvider = {
      id: 'openai-plan',
      type: 'openai-plan',
      oauth: {
        accessToken: 'disconnect-access-token',
        refreshToken: 'disconnect-refresh-token',
        expiresAt: 1_893_456_000_000,
      },
    }
    const settings = createSettings([provider])
    const secretStore = createSecureSecretStore()
    await sanitizeSettingsForPersistence(settings, secretStore)
    const refreshTokenKey = createSecretStoreKey({
      providerId: 'openai-plan',
      providerType: 'openai-plan',
      field: 'refreshToken',
    })

    // When: disconnect clears OAuth and the settings boundary saves again.
    await sanitizeSettingsForPersistence(
      createSettings([{ id: 'openai-plan', type: 'openai-plan' }]),
      secretStore,
      settings,
    )

    // Then: the stored OAuth refresh token is deleted or tombstoned.
    await expect(secretStore.getSecret(refreshTokenKey)).resolves.toBeNull()
  })

  it('disconnect deletes API key secret', async () => {
    // Given: an API-key provider has a secret stored.
    const provider: LLMProvider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'delete-api-key-secret',
    }
    const settings = createSettings([provider])
    const secretStore = createSecureSecretStore()
    await sanitizeSettingsForPersistence(settings, secretStore)
    const apiKey = createSecretStoreKey({
      providerId: 'custom-openai',
      providerType: 'openai',
      field: 'apiKey',
    })

    // When: deleting the provider saves settings without it.
    await sanitizeSettingsForPersistence(
      createSettings([]),
      secretStore,
      settings,
    )

    // Then: the stored API key is deleted.
    await expect(secretStore.getSecret(apiKey)).resolves.toBeNull()
  })
})
