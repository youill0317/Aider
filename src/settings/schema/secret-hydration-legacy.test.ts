import type { SecretStore } from '../../security/secret-store/secret-store'
import {
  hydrateSettingsSecrets,
  sanitizeSettingsForPersistence,
} from '../../security/secret-store/settings-secrets'

import {
  AIDER_OPENAI_API_KEY,
  AIDER_OPENAI_PLAN_ACCESS_TOKEN,
  AIDER_OPENAI_PLAN_REFRESH_TOKEN,
  LEGACY_OPENAI_API_KEY,
  LEGACY_OPENAI_PLAN_ACCESS_TOKEN,
  LEGACY_OPENAI_PLAN_REFRESH_TOKEN,
  createMapBackedSecretStore,
  createPersistedSettingsWithoutSecrets,
  createTestSettings,
} from './secret-hydration.test-support'

describe('Aider legacy Smart Composer secret hydration', () => {
  it('hydrates provider api keys from legacy Smart Composer ids', async () => {
    const values = new Map([[LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key']])
    const secretStore = createMapBackedSecretStore(values)
    const persistedSettings = createPersistedSettingsWithoutSecrets()

    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    expect(hydratedSettings.providers[0].apiKey).toBe('sk-legacy-api-key')
    expect(values.get(AIDER_OPENAI_API_KEY)).toBe('sk-legacy-api-key')
    expect(values.has(LEGACY_OPENAI_API_KEY)).toBe(false)
  })

  it('prefers Aider provider api keys over legacy Smart Composer ids', async () => {
    const values = new Map([
      [AIDER_OPENAI_API_KEY, 'sk-aider-api-key'],
      [LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key'],
    ])
    const secretStore = createMapBackedSecretStore(values)
    const persistedSettings = createPersistedSettingsWithoutSecrets()

    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    expect(hydratedSettings.providers[0].apiKey).toBe('sk-aider-api-key')
    expect(values.get(AIDER_OPENAI_API_KEY)).toBe('sk-aider-api-key')
  })

  it('hydrates OAuth tokens from legacy Smart Composer ids', async () => {
    const values = new Map([
      [LEGACY_OPENAI_PLAN_ACCESS_TOKEN, 'legacy-access-token'],
      [LEGACY_OPENAI_PLAN_REFRESH_TOKEN, 'legacy-refresh-token'],
    ])
    const secretStore = createMapBackedSecretStore(values)
    const persistedSettings = createPersistedSettingsWithoutSecrets()

    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    const planProvider = hydratedSettings.providers[1]
    expect(planProvider.type).toBe('openai-plan')
    if (planProvider.type === 'openai-plan') {
      expect(planProvider.oauth?.accessToken).toBe('legacy-access-token')
      expect(planProvider.oauth?.refreshToken).toBe('legacy-refresh-token')
    }
    expect(values.get(AIDER_OPENAI_PLAN_ACCESS_TOKEN)).toBe(
      'legacy-access-token',
    )
    expect(values.get(AIDER_OPENAI_PLAN_REFRESH_TOKEN)).toBe(
      'legacy-refresh-token',
    )
    expect(values.has(LEGACY_OPENAI_PLAN_ACCESS_TOKEN)).toBe(false)
    expect(values.has(LEGACY_OPENAI_PLAN_REFRESH_TOKEN)).toBe(false)
  })

  it('hydrates legacy secrets when fallback copy fails', async () => {
    const values = new Map([[LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key']])
    const secretStore = createMapBackedSecretStore(values, async () => {
      throw new Error('copy failed')
    })
    const persistedSettings = createPersistedSettingsWithoutSecrets()

    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    expect(hydratedSettings.providers[0].apiKey).toBe('sk-legacy-api-key')
    expect(values.get(AIDER_OPENAI_API_KEY)).toBeUndefined()
    expect(values.get(LEGACY_OPENAI_API_KEY)).toBe('sk-legacy-api-key')
  })

  it('does not copy fallback backend legacy secrets into Aider ids', async () => {
    const copyCalls: string[] = []
    const values = new Map([[LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'insecure-settings-fallback',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        copyCalls.push(`${key}:${value}`)
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }
    const persistedSettings = createPersistedSettingsWithoutSecrets()

    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    expect(hydratedSettings.providers[0].apiKey).toBe('sk-legacy-api-key')
    expect(copyCalls).toEqual([])
    expect(values.has(AIDER_OPENAI_API_KEY)).toBe(false)
    expect(values.get(LEGACY_OPENAI_API_KEY)).toBe('sk-legacy-api-key')
  })

  it('deletes current and legacy api keys when a provider api key is removed', async () => {
    const values = new Map([
      [AIDER_OPENAI_API_KEY, 'sk-aider-api-key'],
      [LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key'],
    ])
    const secretStore = createMapBackedSecretStore(values)
    const previousSettings = createTestSettings()
    const previousProvider = previousSettings.providers[0]
    if (previousProvider.type !== 'openai') {
      throw new Error('Expected first test provider to be openai.')
    }
    const { apiKey: _removedApiKey, ...providerWithoutApiKey } =
      previousProvider
    const nextSettings = {
      ...previousSettings,
      providers: [providerWithoutApiKey, previousSettings.providers[1]],
    }

    await sanitizeSettingsForPersistence(
      nextSettings,
      secretStore,
      previousSettings,
    )

    expect(values.has(AIDER_OPENAI_API_KEY)).toBe(false)
    expect(values.has(LEGACY_OPENAI_API_KEY)).toBe(false)
  })

  it('deletes current and legacy OAuth tokens when OAuth is removed', async () => {
    const values = new Map([
      [AIDER_OPENAI_PLAN_ACCESS_TOKEN, 'aider-access-token'],
      [AIDER_OPENAI_PLAN_REFRESH_TOKEN, 'aider-refresh-token'],
      [LEGACY_OPENAI_PLAN_ACCESS_TOKEN, 'legacy-access-token'],
      [LEGACY_OPENAI_PLAN_REFRESH_TOKEN, 'legacy-refresh-token'],
    ])
    const secretStore = createMapBackedSecretStore(values)
    const previousSettings = createTestSettings()
    const previousPlanProvider = previousSettings.providers[1]
    if (previousPlanProvider.type !== 'openai-plan') {
      throw new Error('Expected second test provider to be openai-plan.')
    }
    const { oauth: _removedOAuth, ...providerWithoutOAuth } =
      previousPlanProvider
    const nextSettings = {
      ...previousSettings,
      providers: [previousSettings.providers[0], providerWithoutOAuth],
    }

    await sanitizeSettingsForPersistence(
      nextSettings,
      secretStore,
      previousSettings,
    )

    expect(values.has(AIDER_OPENAI_PLAN_ACCESS_TOKEN)).toBe(false)
    expect(values.has(AIDER_OPENAI_PLAN_REFRESH_TOKEN)).toBe(false)
    expect(values.has(LEGACY_OPENAI_PLAN_ACCESS_TOKEN)).toBe(false)
    expect(values.has(LEGACY_OPENAI_PLAN_REFRESH_TOKEN)).toBe(false)
  })

  it('deletes current and legacy secrets when a provider is removed', async () => {
    const values = new Map([
      [AIDER_OPENAI_API_KEY, 'sk-aider-api-key'],
      [AIDER_OPENAI_PLAN_ACCESS_TOKEN, 'aider-access-token'],
      [AIDER_OPENAI_PLAN_REFRESH_TOKEN, 'aider-refresh-token'],
      [LEGACY_OPENAI_API_KEY, 'sk-legacy-api-key'],
      [LEGACY_OPENAI_PLAN_ACCESS_TOKEN, 'legacy-access-token'],
      [LEGACY_OPENAI_PLAN_REFRESH_TOKEN, 'legacy-refresh-token'],
    ])
    const secretStore = createMapBackedSecretStore(values)
    const previousSettings = createTestSettings()

    await sanitizeSettingsForPersistence(
      {
        ...previousSettings,
        providers: [],
      },
      secretStore,
      previousSettings,
    )

    expect(values.size).toBe(0)
  })
})
