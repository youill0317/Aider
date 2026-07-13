import type { SmartComposerSettings } from '../../settings/schema/setting.types'

import {
  deleteProviderSecrets,
  providerSecretKeys,
} from './provider-secret-utils'
import {
  createMcpEnvSecretStoreKey,
  createSecretStore,
  createSecretStoreKey,
  createUnversionedLegacyAiderSecretStoreKey,
} from './secret-store'
import type { SecretStore } from './secret-store'
import {
  hydrateSettingsSecrets,
  persistRecognizedRawSettingsSecrets,
  persistSettingsUpdate,
  sanitizeSettingsForPersistence,
} from './settings-secrets'

function createSettings(
  providers: SmartComposerSettings['providers'],
  servers: SmartComposerSettings['mcp']['servers'] = [],
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
      servers,
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
  it('stores MCP environment values outside ordinary settings', async () => {
    const secretStore = createSecretStore({ app: {} })
    const server = {
      id: 'github',
      enabled: true,
      parameters: {
        command: 'node',
        env: { GITHUB_TOKEN: 'mcp-secret-token' },
      },
      toolOptions: {},
    }
    const runtimeSettings = createSettings([], [server])

    const persistedSettings = await sanitizeSettingsForPersistence(
      runtimeSettings,
      secretStore,
    )
    const hydratedSettings = await hydrateSettingsSecrets(
      persistedSettings,
      secretStore,
    )

    expect(JSON.stringify(persistedSettings)).not.toContain('mcp-secret-token')
    expect(persistedSettings.mcp.servers[0].parameters.env).toBeUndefined()
    expect(hydratedSettings.mcp.servers[0].parameters.env).toEqual(
      server.parameters.env,
    )
    await expect(
      secretStore.getSecret(createMcpEnvSecretStoreKey(server.id)),
    ).resolves.toContain('mcp-secret-token')
  })

  it('does not copy an ambiguous unversioned provider secret', async () => {
    const providers = [
      { id: 'foo-bar', type: 'openai' as const },
      { id: 'foo_bar', type: 'openai' as const },
    ]
    const legacyKey = createUnversionedLegacyAiderSecretStoreKey({
      providerId: providers[0].id,
      providerType: providers[0].type,
      field: 'apiKey',
    })
    const values = new Map([[legacyKey, 'shared-legacy-secret']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }

    const hydrated = await hydrateSettingsSecrets(
      createSettings(providers),
      secretStore,
    )

    expect(hydrated.providers.every((provider) => !provider.apiKey)).toBe(true)
    expect(values.get(legacyKey)).toBe('shared-legacy-secret')
    for (const provider of providers) {
      expect(values.has(providerSecretKeys(provider, 'apiKey').current)).toBe(
        false,
      )
    }
  })

  it('rolls back raw secret migration when preserving settings fails', async () => {
    const provider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'sk-new-plaintext-key',
    } as const
    const secretKey = providerSecretKeys(provider, 'apiKey').current
    const values = new Map([[secretKey, 'sk-previous-key']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }
    const rawData = {
      ...createSettings([provider]),
      futureTopLevel: 'keep-me',
    }

    await expect(
      persistRecognizedRawSettingsSecrets({
        rawData,
        secretStore,
        saveData: async () => {
          throw new Error('save failed')
        },
      }),
    ).rejects.toThrow('save failed')

    expect(values.get(secretKey)).toBe('sk-previous-key')
    expect(rawData.providers[0].apiKey).toBe('sk-new-plaintext-key')
    expect(rawData.futureTopLevel).toBe('keep-me')
  })

  it('does not migrate secret-shaped fields from unrecognized raw entries', async () => {
    const setSecret = jest.fn().mockResolvedValue(undefined)
    const saveData = jest.fn().mockResolvedValue(undefined)
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => null,
      setSecret,
      deleteSecret: async () => undefined,
    }

    await persistRecognizedRawSettingsSecrets({
      rawData: {
        providers: [
          {
            id: 'future-provider',
            type: 'future-provider',
            apiKey: 'leave-this-unknown-value',
          },
        ],
        mcp: {
          servers: [
            {
              id: 'future-server',
              enabled: true,
              parameters: {
                command: 42,
                env: { TOKEN: 'leave-this-unknown-value' },
              },
              toolOptions: {},
            },
          ],
        },
      },
      secretStore,
      saveData,
    })

    expect(setSecret).not.toHaveBeenCalled()
    expect(saveData).not.toHaveBeenCalled()
  })

  it.each([
    ['unavailable', new Error('read failed')],
    ['malformed', '{'],
  ])('ignores an %s MCP environment secret', async (_case, failure) => {
    const server = {
      id: 'github',
      enabled: true,
      parameters: { command: 'node' },
      toolOptions: {},
    }
    const warning = jest.spyOn(console, 'warn').mockImplementation()
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => {
        if (failure instanceof Error) throw failure
        return failure
      },
      setSecret: async () => undefined,
      deleteSecret: async () => undefined,
    }

    await expect(
      hydrateSettingsSecrets(createSettings([], [server]), secretStore),
    ).resolves.toEqual(createSettings([], [server]))
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })

  it('ignores an MCP environment secret that exceeds server limits', async () => {
    const server = {
      id: 'github',
      enabled: true,
      parameters: { command: 'node' },
      toolOptions: {},
    }
    const secretStore = createSecretStore({ app: {} })
    await secretStore.setSecret(
      createMcpEnvSecretStoreKey(server.id),
      JSON.stringify({ TOKEN: 'x'.repeat(16_385) }),
    )
    const warning = jest.spyOn(console, 'warn').mockImplementation()

    await expect(
      hydrateSettingsSecrets(createSettings([], [server]), secretStore),
    ).resolves.toEqual(createSettings([], [server]))
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })

  it('does not save blank tokens when secret persistence fails', async () => {
    // Given: Obsidian reports SecretStorage support but rejects secret writes.
    let runtimeSettings: SmartComposerSettings | undefined
    let savedSettings: SmartComposerSettings | undefined
    const storedSecrets = new Map<string, string>()
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => storedSecrets.get(key) ?? null,
      setSecret: async (key, value) => {
        if (key.endsWith('refresh-token')) {
          throw new Error('write failed')
        }
        storedSecrets.set(key, value)
      },
      deleteSecret: async (key) => {
        storedSecrets.delete(key)
      },
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
    expect(storedSecrets.size).toBe(0)
  })

  it('does not rewrite unchanged provider secrets while saving new plan tokens', async () => {
    // Given: an existing API key is already present in runtime settings.
    const writtenSecrets = new Map<string, string>()
    let runtimeSettings: SmartComposerSettings | undefined
    let savedSettings: SmartComposerSettings | undefined
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) =>
        key.endsWith('openai-api-key') ? 'sk-existing-openai-key' : null,
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

  it('stores unchanged plaintext secrets when secure entries are missing', async () => {
    const secretStore = createSecretStore({ app: {} })
    const settings = createSettings([
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-plaintext-api-key',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'plaintext-access-token',
          refreshToken: 'plaintext-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    ])
    let savedSettings: SmartComposerSettings | undefined

    await persistSettingsUpdate({
      previousSettings: settings,
      nextSettings: settings,
      secretStore,
      publishRuntimeSettings: () => undefined,
      saveData: async (persistedSettings) => {
        savedSettings = persistedSettings
      },
    })

    await expect(
      secretStore.getSecret(
        providerSecretKeys(settings.providers[0], 'apiKey').current,
      ),
    ).resolves.toBe('sk-plaintext-api-key')
    await expect(
      secretStore.getSecret(
        providerSecretKeys(settings.providers[1], 'accessToken').current,
      ),
    ).resolves.toBe('plaintext-access-token')
    await expect(
      secretStore.getSecret(
        providerSecretKeys(settings.providers[1], 'refreshToken').current,
      ),
    ).resolves.toBe('plaintext-refresh-token')
    expect(JSON.stringify(savedSettings)).not.toContain('plaintext-')
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

  it('restores a rotated secret and runtime settings when data save fails', async () => {
    const secretKey = createSecretStoreKey({
      providerId: 'custom-openai',
      providerType: 'openai',
      field: 'apiKey',
    })
    const values = new Map([[secretKey, 'sk-old-secret']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }
    const previousSettings = createSettings([
      {
        id: 'custom-openai',
        type: 'openai',
        apiKey: 'sk-old-secret',
      },
    ])
    const nextSettings = createSettings([
      {
        id: 'custom-openai',
        type: 'openai',
        apiKey: 'sk-new-secret',
      },
    ])
    let runtimeSettings: SmartComposerSettings | undefined

    await expect(
      persistSettingsUpdate({
        previousSettings,
        nextSettings,
        secretStore,
        publishRuntimeSettings: (settings) => {
          runtimeSettings = settings
        },
        saveData: async () => {
          throw new Error('save failed')
        },
      }),
    ).rejects.toThrow('save failed')

    expect(values.get(secretKey)).toBe('sk-old-secret')
    expect(runtimeSettings).toBe(previousSettings)
  })

  it('does not hide a failed current-key replacement in a legacy key', async () => {
    const provider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'sk-new-secret',
    } as const
    const keys = providerSecretKeys(provider, 'apiKey')
    const values = new Map([[keys.current, 'sk-old-secret']])
    const setSecret = jest.fn(async (key: string, value: string) => {
      if (key === keys.current && value === provider.apiKey) {
        throw new Error('current write failed')
      }
      values.set(key, value)
    })
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret,
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }
    const previousSettings = createSettings([
      { ...provider, apiKey: 'sk-old-secret' },
    ])
    const nextSettings = createSettings([provider])
    let runtimeSettings: SmartComposerSettings | undefined
    const saveData = jest.fn()

    await expect(
      persistSettingsUpdate({
        previousSettings,
        nextSettings,
        secretStore,
        publishRuntimeSettings: (settings) => {
          runtimeSettings = settings
        },
        saveData,
      }),
    ).rejects.toThrow('current write failed')

    expect(runtimeSettings).toBe(previousSettings)
    expect(saveData).not.toHaveBeenCalled()
    expect(values.get(keys.current)).toBe('sk-old-secret')
    expect(keys.legacy.some((key) => values.has(key))).toBe(false)
    for (const legacyKey of keys.legacy) {
      expect(setSecret).not.toHaveBeenCalledWith(legacyKey, provider.apiKey)
    }
  })

  it('removes a newly written secret when data save fails', async () => {
    const secretKey = createSecretStoreKey({
      providerId: 'custom-openai',
      providerType: 'openai',
      field: 'apiKey',
    })
    const values = new Map<string, string>()
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }

    await expect(
      persistSettingsUpdate({
        previousSettings: createSettings([]),
        nextSettings: createSettings([
          {
            id: 'custom-openai',
            type: 'openai',
            apiKey: 'sk-new-secret',
          },
        ]),
        secretStore,
        publishRuntimeSettings: () => undefined,
        saveData: async () => {
          throw new Error('save failed')
        },
      }),
    ).rejects.toThrow('save failed')

    expect(values.has(secretKey)).toBe(false)
  })

  it('deletes removed secrets inside the rollback-safe save transaction', async () => {
    const secretKey = createSecretStoreKey({
      providerId: 'custom-openai',
      providerType: 'openai',
      field: 'apiKey',
    })
    const values = new Map([[secretKey, 'sk-existing-secret']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        values.delete(key)
      },
    }
    const previousSettings = createSettings([
      {
        id: 'custom-openai',
        type: 'openai',
        apiKey: 'sk-existing-secret',
      },
    ])
    const nextSettings = createSettings([])

    await persistSettingsUpdate({
      previousSettings,
      nextSettings,
      secretStore,
      publishRuntimeSettings: () => undefined,
      saveData: async () => {
        expect(values.has(secretKey)).toBe(false)
      },
    })

    expect(values.has(secretKey)).toBe(false)
  })

  it('restores runtime and skips data save when secret cleanup fails', async () => {
    const secretKey = createSecretStoreKey({
      providerId: 'custom-openai',
      providerType: 'openai',
      field: 'apiKey',
    })
    const values = new Map([[secretKey, 'sk-existing-secret']])
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async () => {
        throw new Error('cleanup failed')
      },
    }
    const previousSettings = createSettings([
      {
        id: 'custom-openai',
        type: 'openai',
        apiKey: 'sk-existing-secret',
      },
    ])
    const nextSettings = createSettings([])
    let runtimeSettings: SmartComposerSettings | undefined

    const saveData = jest.fn()
    await expect(
      persistSettingsUpdate({
        previousSettings,
        nextSettings,
        secretStore,
        publishRuntimeSettings: (settings) => {
          runtimeSettings = settings
        },
        saveData,
      }),
    ).rejects.toThrow('previous secrets could not be restored')

    expect(runtimeSettings).toBe(previousSettings)
    expect(saveData).not.toHaveBeenCalled()
    expect(values.get(secretKey)).toBe('sk-existing-secret')
  })

  it('waits for each secret deletion before rolling back a later failure', async () => {
    const provider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'sk-existing-secret',
    } as const
    const keys = providerSecretKeys(provider, 'apiKey')
    const values = new Map<string, string>([[keys.current, provider.apiKey]])
    let releaseCurrentDelete: (() => void) | undefined
    let markCurrentDeleteStarted: (() => void) | undefined
    const currentDeleteStarted = new Promise<void>((resolve) => {
      markCurrentDeleteStarted = resolve
    })
    let legacyDeleteFailed = false
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async (key) => values.get(key) ?? null,
      setSecret: async (key, value) => {
        values.set(key, value)
      },
      deleteSecret: async (key) => {
        if (key === keys.current) {
          markCurrentDeleteStarted?.()
          await new Promise<void>((resolve) => {
            releaseCurrentDelete = resolve
          })
        }
        if (key === keys.legacy[0] && !legacyDeleteFailed) {
          legacyDeleteFailed = true
          throw new Error('cleanup failed')
        }
        values.delete(key)
      },
    }
    const saveData = jest.fn()
    const update = persistSettingsUpdate({
      previousSettings: createSettings([provider]),
      nextSettings: createSettings([]),
      secretStore,
      publishRuntimeSettings: () => undefined,
      saveData,
    })
    const observedUpdate = update.catch((error: unknown) => error)

    await currentDeleteStarted
    await Promise.resolve()
    await Promise.resolve()
    releaseCurrentDelete?.()

    await expect(observedUpdate).resolves.toEqual(
      expect.objectContaining({ message: 'cleanup failed' }),
    )
    expect(values.get(keys.current)).toBe(provider.apiKey)
    expect(saveData).not.toHaveBeenCalled()
  })

  it('attempts every provider secret deletion before reporting a failure', async () => {
    const provider = { id: 'custom-openai', type: 'openai' } as const
    const keys = providerSecretKeys(provider, 'apiKey')
    const expectedKeys = [keys.current, ...keys.legacy]
    const attemptedKeys: string[] = []
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => null,
      setSecret: async () => undefined,
      deleteSecret: async (key) => {
        attemptedKeys.push(key)
        if (key === keys.current) throw new Error('first delete failed')
      },
    }

    await expect(deleteProviderSecrets(secretStore, keys)).rejects.toThrow(
      'first delete failed',
    )

    expect(attemptedKeys).toEqual(expectedKeys)
  })

  it('rejects duplicate provider IDs before touching secret storage', async () => {
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
    }
    const settings = createSettings([
      { id: 'duplicate', type: 'openai', apiKey: 'first' },
      { id: 'duplicate', type: 'anthropic', apiKey: 'second' },
    ])

    await expect(
      sanitizeSettingsForPersistence(settings, secretStore),
    ).rejects.toThrow('Provider IDs must be unique')
    expect(secretStore.getSecret).not.toHaveBeenCalled()
    expect(secretStore.setSecret).not.toHaveBeenCalled()
    expect(secretStore.deleteSecret).not.toHaveBeenCalled()
  })

  it('rejects duplicate MCP server IDs before publishing or persisting', async () => {
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: jest.fn().mockResolvedValue(null),
      setSecret: jest.fn().mockResolvedValue(undefined),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
    }
    const server = {
      id: 'duplicate',
      enabled: true,
      parameters: { command: 'node', env: { TOKEN: 'first' } },
      toolOptions: {},
    }
    const publishRuntimeSettings = jest.fn()
    const saveData = jest.fn()

    await expect(
      persistSettingsUpdate({
        previousSettings: createSettings([]),
        nextSettings: createSettings(
          [],
          [
            server,
            {
              ...server,
              parameters: { command: 'node', env: { TOKEN: 'second' } },
            },
          ],
        ),
        secretStore,
        publishRuntimeSettings,
        saveData,
      }),
    ).rejects.toThrow('MCP server IDs must be unique')
    expect(publishRuntimeSettings).not.toHaveBeenCalled()
    expect(saveData).not.toHaveBeenCalled()
    expect(secretStore.getSecret).not.toHaveBeenCalled()
    expect(secretStore.setSecret).not.toHaveBeenCalled()
  })
})
