import type { ViewCreator } from 'obsidian'

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
