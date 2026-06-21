import type { SmartComposerSettings } from '../../settings/schema/setting.types'

import { createSecretStore } from './secret-store'
import type { SecretStore } from './secret-store'
import {
  hydrateSettingsSecrets,
  persistSettingsUpdate,
} from './settings-secrets'

function createSettings(
  providers: SmartComposerSettings['providers'],
): SmartComposerSettings {
  return {
    version: 20,
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

describe('settings secret persistence', () => {
  it('does not save blank tokens when secret persistence fails', async () => {
    // Given: Obsidian reports SecretStorage support but rejects secret writes.
    let runtimeSettings: SmartComposerSettings | undefined
    let savedSettings: SmartComposerSettings | undefined
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => null,
      setSecret: async () => {
        throw new Error('write failed')
      },
      deleteSecret: async () => undefined,
    }
    const disconnectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])
    const connectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'connected-access-token',
          refreshToken: 'connected-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    ])

    // When/Then: the failing secret write aborts the ordinary settings save.
    await expect(
      persistSettingsUpdate({
        previousSettings: disconnectedSettings,
        nextSettings: connectedSettings,
        secretStore,
        publishRuntimeSettings: (settings) => {
          runtimeSettings = settings
        },
        saveData: async (settings) => {
          savedSettings = settings
        },
      }),
    ).rejects.toThrow('write failed')
    expect(runtimeSettings).toBe(disconnectedSettings)
    expect(savedSettings).toBeUndefined()
  })

  it('does not rewrite unchanged provider secrets while saving new plan tokens', async () => {
    // Given: an existing API key is already present in runtime settings.
    const writtenSecrets = new Map<string, string>()
    let runtimeSettings: SmartComposerSettings | undefined
    let savedSettings: SmartComposerSettings | undefined
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => null,
      setSecret: async (key, value) => {
        writtenSecrets.set(key, value)
        if (key.endsWith('openai-api-key')) {
          throw new Error('unchanged api key rewrite')
        }
      },
      deleteSecret: async () => undefined,
    }
    const previousSettings = createSettings([
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-existing-openai-key',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])
    const connectedSettings = createSettings([
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-existing-openai-key',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'connected-access-token',
          refreshToken: 'connected-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    ])

    // When: the plan login saves new OAuth tokens.
    await persistSettingsUpdate({
      previousSettings,
      nextSettings: connectedSettings,
      secretStore,
      publishRuntimeSettings: (settings) => {
        runtimeSettings = settings
      },
      saveData: async (settings) => {
        savedSettings = settings
      },
    })

    // Then: unchanged existing secrets do not block the plan login save.
    expect(runtimeSettings).toBe(connectedSettings)
    expect(
      [...writtenSecrets.keys()].some((key) => key.endsWith('openai-api-key')),
    ).toBe(false)
    expect(
      [...writtenSecrets.entries()].find(([key]) =>
        key.endsWith('openai-plan-access-token'),
      )?.[1],
    ).toBe('connected-access-token')
    expect(
      [...writtenSecrets.entries()].find(([key]) =>
        key.endsWith('openai-plan-refresh-token'),
      )?.[1],
    ).toBe('connected-refresh-token')
    expect(savedSettings?.providers[0]).not.toHaveProperty('apiKey')
    const savedPlanProvider = savedSettings?.providers[1]
    expect(
      savedPlanProvider?.type === 'openai-plan'
        ? savedPlanProvider.oauth
        : undefined,
    ).toMatchObject({
      accessToken: '',
      refreshToken: '',
    })
  })

  it('saves long plan tokens through chunked Obsidian secrets', async () => {
    // Given: the Obsidian backend rejects a full OAuth token in one entry.
    const secretStorageValues = new Map<string, string>()
    let savedSettings: SmartComposerSettings | undefined
    const secretStore = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
          setSecret: async (key: string, value: string) => {
            if (value.length > 1100) {
              throw new Error('secret value too large')
            }
            secretStorageValues.set(key, value)
          },
        },
      },
    })
    const accessToken = `${'access-token-part.'.repeat(80)}end`
    const refreshToken = `${'refresh-token-part.'.repeat(80)}end`
    const disconnectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])
    const connectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken,
          refreshToken,
          expiresAt: 1_893_456_000_000,
        },
      },
    ])

    // When: the plan login persists long OAuth credentials.
    await persistSettingsUpdate({
      previousSettings: disconnectedSettings,
      nextSettings: connectedSettings,
      secretStore,
      publishRuntimeSettings: () => undefined,
      saveData: async (settings) => {
        savedSettings = settings
      },
    })
    const hydratedSettings = await hydrateSettingsSecrets(
      savedSettings ?? disconnectedSettings,
      secretStore,
    )

    // Then: persisted settings stay sanitized and runtime hydration recovers the tokens.
    const savedProvider = savedSettings?.providers[0]
    expect(
      savedProvider?.type === 'openai-plan' ? savedProvider.oauth : undefined,
    ).toMatchObject({
      accessToken: '',
      refreshToken: '',
    })
    const hydratedProvider = hydratedSettings.providers[0]
    expect(
      hydratedProvider.type === 'openai-plan'
        ? hydratedProvider.oauth
        : undefined,
    ).toMatchObject({
      accessToken,
      refreshToken,
    })
    expect(
      [...secretStorageValues.values()].some((value) => value === accessToken),
    ).toBe(false)
  })
})
