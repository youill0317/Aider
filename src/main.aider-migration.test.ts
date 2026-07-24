import type { ViewCreator } from 'obsidian'

import { createTestApp } from './adoption/aiderStorageAdoption.test-support'
import { loadAiderMigrationWiring } from './aiderMigrationWiring'
import {
  APPLY_VIEW_TYPE,
  CHAT_VIEW_TYPE,
  LEGACY_APPLY_VIEW_TYPE,
  LEGACY_CHAT_VIEW_TYPE,
} from './constants'
import { McpManager } from './core/mcp/mcpManager'
import { DatabaseManager } from './database/DatabaseManager'
import SmartComposerPlugin from './main'
import { smartComposerSettingsSchema } from './settings/schema/setting.types'

jest.mock('./ApplyView', () => ({
  ApplyView: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./ChatView', () => ({
  ChatView: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./settings/SettingTab', () => ({
  SmartComposerSettingTab: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./core/mcp/mcpManager', () => ({
  McpManager: jest.fn().mockImplementation(() => ({
    cleanup: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('./database/DatabaseManager', () => ({
  DatabaseManager: {
    create: jest.fn(),
  },
}))

type WiringHarness = {
  adoptSmartComposerData: () => Promise<void>
  applyView: ViewCreator
  chatView: ViewCreator
  loadSettings: () => Promise<void>
  registerView: jest.Mock<void, [string, ViewCreator]>
}

function createHarness(calls: string[] = []): WiringHarness {
  const applyView = createUnusedViewCreator()
  const chatView = createUnusedViewCreator()

  return {
    adoptSmartComposerData: async () => {
      calls.push('adopt')
    },
    applyView,
    chatView,
    loadSettings: async () => {
      calls.push('load')
    },
    registerView: jest.fn(),
  }
}

function createUnusedViewCreator(): ViewCreator {
  return () => {
    throw new Error('view creator should not run during wiring tests')
  }
}

async function loadHarness(harness: WiringHarness): Promise<void> {
  await loadAiderMigrationWiring(
    {
      adoptSmartComposerData: harness.adoptSmartComposerData,
      loadSettings: harness.loadSettings,
      registerView: harness.registerView,
    },
    {
      applyView: harness.applyView,
      chatView: harness.chatView,
    },
  )
}

describe('Aider plugin migration wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('uses canonical Aider view types while retaining Smart Composer aliases', () => {
    expect(CHAT_VIEW_TYPE).toBe('aider-chat-view')
    expect(APPLY_VIEW_TYPE).toBe('aider-apply-view')
    expect(LEGACY_CHAT_VIEW_TYPE).toBe('smtcmp-chat-view')
    expect(LEGACY_APPLY_VIEW_TYPE).toBe('smtcmp-apply-view')
  })

  it('runs Aider adoption before loading settings', async () => {
    const calls: string[] = []
    const harness = createHarness(calls)

    await loadHarness(harness)

    expect(calls).toEqual(['adopt', 'load'])
  })

  it('continues startup when malformed legacy data cannot be adopted', async () => {
    const app = createTestApp()
    const adapter = app.vault.adapter
    await adapter.mkdir('.obsidian/plugins/smart-composer')
    await adapter.write('.obsidian/plugins/smart-composer/data.json', '[]')
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      app,
    }) as SmartComposerPlugin
    const harness = createHarness()
    const loadSettings = jest.fn().mockResolvedValue(undefined)

    await loadAiderMigrationWiring(
      {
        adoptSmartComposerData: () =>
          (
            plugin as unknown as {
              adoptSmartComposerData(): Promise<void>
            }
          ).adoptSmartComposerData(),
        loadSettings,
        registerView: harness.registerView,
      },
      {
        applyView: harness.applyView,
        chatView: harness.chatView,
      },
    )

    expect(loadSettings).toHaveBeenCalledTimes(1)
    expect(harness.registerView.mock.calls.map((call) => call[0])).toEqual([
      CHAT_VIEW_TYPE,
      APPLY_VIEW_TYPE,
      LEGACY_CHAT_VIEW_TYPE,
      LEGACY_APPLY_VIEW_TYPE,
    ])
    expect(await adapter.exists('.obsidian/plugins/aider/data.json')).toBe(
      false,
    )
  })

  it('moves recognized plaintext secrets without discarding unknown settings', async () => {
    const secretValues = new Map<string, string>()
    const app = {
      secretStorage: {
        getSecret: async (key: string) => secretValues.get(key) ?? null,
        setSecret: async (key: string, value: string) => {
          secretValues.set(key, value)
        },
        deleteSecret: async (key: string) => {
          secretValues.delete(key)
        },
      },
    }
    const defaultSettings = smartComposerSettingsSchema.parse({})
    const rawSettings = {
      ...defaultSettings,
      futureTopLevel: { keep: true },
      providers: [
        {
          id: 'custom-openai',
          type: 'openai',
          apiKey: 'plaintext-api-key',
          futureProviderOption: 'keep-provider',
        },
        {
          id: 'openai-plan',
          type: 'openai-plan',
          oauth: {
            accessToken: 'plaintext-access-token',
            refreshToken: 'plaintext-refresh-token',
            expiresAt: 1_893_456_000_000,
            futureOauthOption: 'keep-oauth',
          },
        },
        ...defaultSettings.providers.filter(({ id }) => id !== 'openai-plan'),
      ],
      mcp: {
        futureMcpOption: 'keep-mcp',
        servers: [
          {
            id: 'github',
            enabled: true,
            parameters: {
              command: 'node',
              env: { GITHUB_TOKEN: 'plaintext-mcp-token' },
              futureParameterOption: 'keep-parameter',
            },
            toolOptions: {},
            futureServerOption: 'keep-server',
          },
        ],
      },
    }
    const firstSave = jest.fn().mockResolvedValue(undefined)
    const firstPlugin = Object.assign(
      Object.create(SmartComposerPlugin.prototype),
      {
        app,
        loadData: jest.fn().mockResolvedValue(rawSettings),
        saveData: firstSave,
        secretStore: null,
      },
    ) as SmartComposerPlugin

    await firstPlugin.loadSettings()

    expect(firstSave).toHaveBeenCalledTimes(1)
    const persistedSettings = firstSave.mock.calls[0][0]
    expect(persistedSettings).toMatchObject({
      futureTopLevel: { keep: true },
      mcp: {
        futureMcpOption: 'keep-mcp',
        servers: [
          {
            parameters: { futureParameterOption: 'keep-parameter' },
            futureServerOption: 'keep-server',
          },
        ],
      },
    })
    expect(persistedSettings.providers.slice(0, 2)).toMatchObject([
      {
        id: 'custom-openai',
        futureProviderOption: 'keep-provider',
      },
      {
        id: 'openai-plan',
        oauth: {
          accessToken: '',
          refreshToken: '',
          futureOauthOption: 'keep-oauth',
        },
      },
    ])
    expect(JSON.stringify(persistedSettings)).not.toContain('plaintext-')

    const reloadSave = jest.fn().mockResolvedValue(undefined)
    const reloadedPlugin = Object.assign(
      Object.create(SmartComposerPlugin.prototype),
      {
        app,
        loadData: jest.fn().mockResolvedValue(persistedSettings),
        saveData: reloadSave,
        secretStore: null,
      },
    ) as SmartComposerPlugin

    await reloadedPlugin.loadSettings()

    expect(reloadedPlugin.settings.providers[0].apiKey).toBe(
      'plaintext-api-key',
    )
    const planProvider = reloadedPlugin.settings.providers[1]
    expect(
      planProvider.type === 'openai-plan' ? planProvider.oauth : undefined,
    ).toMatchObject({
      accessToken: 'plaintext-access-token',
      refreshToken: 'plaintext-refresh-token',
    })
    expect(reloadedPlugin.settings.mcp.servers[0].parameters.env).toEqual({
      GITHUB_TOKEN: 'plaintext-mcp-token',
    })
    expect(reloadSave).not.toHaveBeenCalled()
  })

  it('registers canonical and legacy Smart Composer view aliases for one release', async () => {
    const harness = createHarness()

    await loadHarness(harness)

    expect(harness.registerView.mock.calls.map((call) => call[0])).toEqual([
      CHAT_VIEW_TYPE,
      APPLY_VIEW_TYPE,
      LEGACY_CHAT_VIEW_TYPE,
      LEGACY_APPLY_VIEW_TYPE,
    ])
    expect(harness.registerView.mock.calls[0]?.[1]).toBe(harness.chatView)
    expect(harness.registerView.mock.calls[1]?.[1]).toBe(harness.applyView)
    expect(harness.registerView.mock.calls[2]?.[1]).toBe(harness.chatView)
    expect(harness.registerView.mock.calls[3]?.[1]).toBe(harness.applyView)
  })

  it('keeps loading when Smart Composer already owns legacy view aliases', async () => {
    // Given: the original Smart Composer plugin is still enabled.
    const harness = createHarness()
    const warningSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    harness.registerView.mockImplementation((viewType) => {
      if (
        viewType === LEGACY_CHAT_VIEW_TYPE ||
        viewType === LEGACY_APPLY_VIEW_TYPE
      ) {
        throw new Error(`View type already registered: ${viewType}`)
      }
    })

    // When: Aider registers its views during startup.
    await loadHarness(harness)

    // Then: canonical Aider views still register and optional legacy aliases are skipped.
    expect(harness.registerView.mock.calls.map((call) => call[0])).toEqual([
      CHAT_VIEW_TYPE,
      APPLY_VIEW_TYPE,
      LEGACY_CHAT_VIEW_TYPE,
      LEGACY_APPLY_VIEW_TYPE,
    ])
    expect(warningSpy).toHaveBeenCalledTimes(2)
  })

  it('registers views without waiting for vector-index adoption', async () => {
    const calls: string[] = []
    let finishVectorAdoption: (() => void) | undefined
    const migrateToJsonStorage = jest.fn(async () => {
      calls.push('migrate')
    })
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      app: {},
      adoptionTask: null,
      unloading: false,
      adoptSmartComposerData: async () => {
        calls.push('adopt-critical')
      },
      loadSettings: async () => {
        calls.push('load-settings')
      },
      registerView: (type: string) => {
        calls.push(`register:${type}`)
      },
      adoptSmartComposerVectorData: () =>
        new Promise<boolean>((resolve) => {
          calls.push('adopt-vector')
          finishVectorAdoption = () => resolve(true)
        }),
      addRibbonIcon: jest.fn(),
      addCommand: jest.fn(),
      addSettingTab: jest.fn(),
      migrateToJsonStorage,
    }) as SmartComposerPlugin

    await plugin.onload()

    expect(calls).toEqual([
      'adopt-critical',
      'load-settings',
      `register:${CHAT_VIEW_TYPE}`,
      `register:${APPLY_VIEW_TYPE}`,
      `register:${LEGACY_CHAT_VIEW_TYPE}`,
      `register:${LEGACY_APPLY_VIEW_TYPE}`,
      'adopt-vector',
    ])
    expect(migrateToJsonStorage).not.toHaveBeenCalled()
    const migrationTask = (
      plugin as unknown as { migrationTask: Promise<void> }
    ).migrationTask
    finishVectorAdoption?.()
    await migrationTask
    expect(calls.at(-1)).toBe('migrate')
  })

  it('defers the migration marker until vector adoption can complete', async () => {
    const migrateToJsonStorage = jest.fn().mockResolvedValue(undefined)
    const vectorAdoptionResults = [false, true]
    const createPlugin = () =>
      Object.assign(Object.create(SmartComposerPlugin.prototype), {
        app: {},
        adoptionTask: null,
        migrationTask: null,
        unloading: false,
        adoptSmartComposerData: jest.fn().mockResolvedValue(undefined),
        loadSettings: jest.fn().mockResolvedValue(undefined),
        registerView: jest.fn(),
        adoptSmartComposerVectorData: jest
          .fn()
          .mockResolvedValue(vectorAdoptionResults.shift()),
        addRibbonIcon: jest.fn(),
        addCommand: jest.fn(),
        addSettingTab: jest.fn(),
        migrateToJsonStorage,
      }) as SmartComposerPlugin

    const failedAttempt = createPlugin()
    await failedAttempt.onload()
    await (failedAttempt as unknown as { migrationTask: Promise<void> })
      .migrationTask
    expect(migrateToJsonStorage).toHaveBeenNthCalledWith(1, false)

    const successfulRetry = createPlugin()
    await successfulRetry.onload()
    await (successfulRetry as unknown as { migrationTask: Promise<void> })
      .migrationTask
    expect(migrateToJsonStorage).toHaveBeenNthCalledWith(2, true)
  })

  it('keeps migration pending until a late legacy vector database is adopted', async () => {
    const app = createTestApp()
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      app,
    }) as SmartComposerPlugin
    const adoptVectorData = () =>
      (
        plugin as unknown as {
          adoptSmartComposerVectorData(): Promise<boolean>
        }
      ).adoptSmartComposerVectorData()

    expect(await adoptVectorData()).toBe(false)

    await app.vault.adapter.writeBinary(
      '.smtcmp_vector_db.tar.gz',
      new TextEncoder().encode('legacy-vector').buffer,
    )

    expect(await adoptVectorData()).toBe(true)
  })

  it('applies queued model and tool updates to the latest settings', async () => {
    const defaults = smartComposerSettingsSchema.parse({})
    const alternateModel = {
      ...defaults.chatModels[0],
      id: 'alternate-model',
    }
    const settings = smartComposerSettingsSchema.parse({
      ...defaults,
      chatModels: [...defaults.chatModels, alternateModel],
      chatOptions: {
        ...defaults.chatOptions,
        enableTools: false,
      },
    })
    let releaseFirstSave: (() => void) | undefined
    let markFirstSaveStarted: (() => void) | undefined
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve
    })
    const saveData = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirstSave = resolve
            markFirstSaveStarted?.()
          }),
      )
      .mockResolvedValue(undefined)
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      settings,
      settingsSaveQueue: null,
      settingsChangeListeners: [],
      ragEngine: null,
      secretStore: {
        getBackendStatus: () => 'obsidian-secret-storage',
        getSecret: async () => null,
        setSecret: async () => undefined,
        deleteSecret: async () => undefined,
      },
      saveData,
    }) as SmartComposerPlugin

    const selectModel = plugin.setSettings((currentSettings) => ({
      ...currentSettings,
      chatModelId: alternateModel.id,
    }))
    await firstSaveStarted
    const enableTools = plugin.setSettings((currentSettings) => ({
      ...currentSettings,
      chatOptions: {
        ...currentSettings.chatOptions,
        enableTools: true,
      },
    }))
    releaseFirstSave?.()

    await Promise.all([selectModel, enableTools])

    expect(plugin.settings.chatModelId).toBe(alternateModel.id)
    expect(plugin.settings.chatOptions.enableTools).toBe(true)
    expect(saveData).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid settings instead of reporting a successful save', async () => {
    const settings = smartComposerSettingsSchema.parse({})
    const saveData = jest.fn()
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      settings,
      settingsSaveQueue: null,
      settingsChangeListeners: [],
      ragEngine: null,
      secretStore: {
        getBackendStatus: () => 'obsidian-secret-storage',
        getSecret: async () => null,
        setSecret: async () => undefined,
        deleteSecret: async () => undefined,
      },
      saveData,
    }) as SmartComposerPlugin

    await expect(
      plugin.setSettings((currentSettings) => ({
        ...currentSettings,
        chatModelId: 'missing-model',
      })),
    ).rejects.toThrow('Selected model missing-model does not exist')
    expect(saveData).not.toHaveBeenCalled()
    expect(plugin.settings).toBe(settings)
  })

  it('waits for unload settings durability before reactivation', async () => {
    let finishSettingsSave: (() => void) | undefined
    const settingsSave = new Promise<void>((resolve) => {
      finishSettingsSave = resolve
    })
    const unloadingPlugin = Object.assign(
      Object.create(SmartComposerPlugin.prototype),
      {
        adoptionTask: null,
        codexToolRunner: null,
        dbManager: null,
        dbManagerInitPromise: null,
        mcpManager: null,
        mcpManagerInitPromise: null,
        ragEngine: null,
        ragEngineInitPromise: null,
        settingsChangeListeners: [],
        settingsSaveQueue: settingsSave,
        timeoutIds: [],
        toolDispatcher: null,
        unloading: false,
      },
    ) as SmartComposerPlugin
    unloadingPlugin.onunload()

    const calls: string[] = []
    const reactivatedPlugin = Object.assign(
      Object.create(SmartComposerPlugin.prototype),
      {
        app: {},
        adoptionTask: null,
        unloading: false,
        adoptSmartComposerData: async () => {
          calls.push('adopt')
        },
        loadSettings: async () => {
          calls.push('load')
        },
        registerView: jest.fn(),
        adoptSmartComposerVectorData: async () => true,
        addRibbonIcon: jest.fn(),
        addCommand: jest.fn(),
        addSettingTab: jest.fn(),
        migrateToJsonStorage: jest.fn(),
      },
    ) as SmartComposerPlugin

    const loading = reactivatedPlugin.onload()
    await Promise.resolve()
    expect(calls).toEqual([])

    finishSettingsSave?.()
    await loading

    expect(calls).toEqual(['adopt', 'load'])
  })

  it('does not close the database while RAG initialization is settling', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    let finishRagInitialization: (() => void) | undefined
    const ragEngineInitPromise = new Promise<never>((_resolve, reject) => {
      finishRagInitialization = () =>
        reject(new Error('unloaded during RAG initialization'))
    })
    const cleanupDatabase = jest.fn().mockResolvedValue(undefined)
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      adoptionTask: null,
      codexToolRunner: null,
      dbManager: { cleanup: cleanupDatabase },
      dbManagerInitPromise: null,
      mcpManager: null,
      mcpManagerInitPromise: null,
      ragEngine: null,
      ragEngineInitPromise,
      settingsChangeListeners: [],
      settingsSaveQueue: null,
      timeoutIds: [],
      toolDispatcher: null,
      unloading: false,
    }) as SmartComposerPlugin

    plugin.onunload()
    const cleanupBarrier = (
      globalThis as typeof globalThis & {
        __aiderPluginCleanupBarrier?: Promise<void>
      }
    ).__aiderPluginCleanupBarrier
    await Promise.resolve()
    expect(cleanupDatabase).not.toHaveBeenCalled()

    finishRagInitialization?.()
    await cleanupBarrier

    expect(cleanupDatabase).toHaveBeenCalledTimes(1)
  })

  it('creates a Codex-only dispatcher without initializing MCP when tools are disabled', async () => {
    const defaults = smartComposerSettingsSchema.parse({})
    const settings = smartComposerSettingsSchema.parse({
      ...defaults,
      chatOptions: {
        ...defaults.chatOptions,
        enableTools: false,
      },
    })
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      codexToolRunner: {},
      mcpManager: null,
      mcpManagerInitPromise: null,
      settings,
      settingsChangeListeners: [],
      toolDispatcher: null,
      unloading: false,
    }) as SmartComposerPlugin

    await plugin.getToolDispatcher()

    expect(McpManager).not.toHaveBeenCalled()
  })

  it('shares MCP initialization across concurrent callers', async () => {
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      mcpManager: null,
      mcpManagerInitPromise: null,
      settings: {},
      settingsChangeListeners: [],
    }) as SmartComposerPlugin

    const managers = await Promise.all(
      Array.from({ length: 10 }, () => plugin.getMcpManager()),
    )

    expect(new Set(managers).size).toBe(1)
    expect(McpManager).toHaveBeenCalledTimes(1)
    expect(
      (McpManager as unknown as jest.Mock).mock.results[0].value.initialize,
    ).toHaveBeenCalledTimes(1)
  })

  it('cleans up MCP initialization that finishes after unload', async () => {
    let finishInitialization: (() => void) | undefined
    const cleanup = jest.fn()
    ;(McpManager as unknown as jest.Mock).mockImplementationOnce(() => ({
      cleanup,
      initialize: () =>
        new Promise<void>((resolve) => {
          finishInitialization = resolve
        }),
    }))
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      dbManager: null,
      dbManagerInitPromise: null,
      mcpManager: null,
      mcpManagerInitPromise: null,
      ragEngine: null,
      ragEngineInitPromise: null,
      settings: {},
      settingsChangeListeners: [],
      timeoutIds: [],
      unloading: false,
    }) as SmartComposerPlugin

    const initializing = plugin.getMcpManager()
    plugin.onunload()
    finishInitialization?.()

    await expect(initializing).rejects.toThrow(
      'Aider unloaded during MCP initialization',
    )
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('closes database initialization that finishes after unload', async () => {
    let finishInitialization: ((manager: unknown) => void) | undefined
    const cleanup = jest.fn().mockResolvedValue(undefined)
    ;(DatabaseManager.create as unknown as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        finishInitialization = resolve
      }),
    )
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      app: {},
      dbManager: null,
      dbManagerInitPromise: null,
      mcpManager: null,
      mcpManagerInitPromise: null,
      ragEngine: null,
      ragEngineInitPromise: null,
      settingsChangeListeners: [],
      timeoutIds: [],
      unloading: false,
    }) as SmartComposerPlugin

    const initializing = plugin.getDbManager()
    plugin.onunload()
    finishInitialization?.({ cleanup })

    await expect(initializing).rejects.toThrow(
      'Aider unloaded during database initialization',
    )
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('does not initialize services after unload starts', async () => {
    const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
      app: {},
      codexToolRunner: null,
      dbManager: null,
      dbManagerInitPromise: null,
      mcpManager: null,
      mcpManagerInitPromise: null,
      ragEngine: null,
      ragEngineInitPromise: null,
      settingsChangeListeners: [],
      timeoutIds: [],
      toolDispatcher: null,
      unloading: false,
    }) as SmartComposerPlugin

    plugin.onunload()

    await expect(plugin.getDbManager()).rejects.toThrow('Aider is unloading')
    await expect(plugin.getRAGEngine()).rejects.toThrow('Aider is unloading')
    await expect(plugin.getMcpManager()).rejects.toThrow('Aider is unloading')
    expect(() => plugin.getCodexToolRunner()).toThrow('Aider is unloading')
    await expect(plugin.getToolDispatcher()).rejects.toThrow(
      'Aider is unloading',
    )
    expect(
      (DatabaseManager.create as unknown as jest.Mock).mock.calls,
    ).toHaveLength(0)
    expect(McpManager).not.toHaveBeenCalled()
  })
})
