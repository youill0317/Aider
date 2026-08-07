import { PGLiteAbortedException } from './database/exception'
import SmartComposerPlugin from './main'

jest.mock('./ApplyView', () => ({ ApplyView: jest.fn() }))
jest.mock('./ChatView', () => ({ ChatView: jest.fn() }))
jest.mock('./settings/SettingTab', () => ({
  SmartComposerSettingTab: jest.fn(),
}))
jest.mock('./core/mcp/mcpManager', () => ({ McpManager: jest.fn() }))
jest.mock('./security/secret-store/secret-store', () => ({
  createSecretStore: jest.fn(() => ({})),
}))

const mockCreate = jest.fn()
jest.mock('./database/DatabaseManager', () => ({
  DatabaseManager: {
    create: (app: unknown) => mockCreate(app) as unknown,
  },
}))

const mockRagCleanup = jest.fn()
jest.mock('./core/rag/ragEngine', () => ({
  RAGEngine: jest.fn().mockImplementation(() => ({
    cleanup: () => mockRagCleanup() as unknown,
    setSettings: jest.fn(),
  })),
}))

const mockInstallerModalOpen = jest.fn()
jest.mock('./components/modals/InstallerUpdateRequiredModal', () => ({
  InstallerUpdateRequiredModal: jest
    .fn()
    .mockImplementation(() => ({ open: mockInstallerModalOpen })),
}))

/**
 * Builds a plugin with only the fields the lazy getters touch. Nothing here
 * is loaded eagerly, so the test observes exactly what initialization does.
 */
function createPlugin() {
  return Object.assign(Object.create(SmartComposerPlugin.prototype), {
    app: {},
    dbManager: null,
    dbManagerInitPromise: null,
    ragEngine: null,
    ragEngineInitPromise: null,
    settings: {},
    unloading: false,
  }) as SmartComposerPlugin
}

function startUnloading(plugin: SmartComposerPlugin) {
  ;(plugin as unknown as { unloading: boolean }).unloading = true
}

function createManager() {
  return {
    cleanup: jest.fn().mockResolvedValue(undefined),
    getVectorManager: jest.fn(() => ({})),
  }
}

describe('SmartComposerPlugin lazy database init', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockRagCleanup.mockReset().mockResolvedValue(undefined)
    mockInstallerModalOpen.mockReset()
  })

  it('does not create the database until something asks for it', () => {
    const plugin = createPlugin()

    expect(plugin.dbManager).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates the database once for concurrent callers', async () => {
    const manager = createManager()
    let resolveCreate: ((value: unknown) => void) | undefined
    mockCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const plugin = createPlugin()

    const both = Promise.all([plugin.getDbManager(), plugin.getDbManager()])
    resolveCreate?.(manager)
    const [first, second] = await both

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(first).toBe(manager)
    expect(second).toBe(manager)
  })

  it('reuses the created database on later calls', async () => {
    const manager = createManager()
    mockCreate.mockResolvedValue(manager)
    const plugin = createPlugin()

    await plugin.getDbManager()
    await plugin.getDbManager()

    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed creation instead of caching the failure', async () => {
    const manager = createManager()
    mockCreate
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce(manager)
    const plugin = createPlugin()

    await expect(plugin.getDbManager()).rejects.toThrow('database is locked')
    await expect(plugin.getDbManager()).resolves.toBe(manager)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('prompts for an installer update when PGLite aborts', async () => {
    mockCreate.mockRejectedValue(new PGLiteAbortedException())
    const plugin = createPlugin()

    await expect(plugin.getDbManager()).rejects.toThrow(
      'PGLite aborted during runtime',
    )
    expect(mockInstallerModalOpen).toHaveBeenCalledTimes(1)
  })

  it('refuses to start initialization once unloading', async () => {
    const plugin = createPlugin()
    startUnloading(plugin)

    await expect(plugin.getDbManager()).rejects.toThrow('Aider is unloading')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('closes a database that finished creating after unload started', async () => {
    const manager = createManager()
    let resolveCreate: ((value: unknown) => void) | undefined
    mockCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const plugin = createPlugin()

    const pending = plugin.getDbManager()
    startUnloading(plugin)
    resolveCreate?.(manager)

    await expect(pending).rejects.toThrow(
      'Aider unloaded during database initialization',
    )
    // A leaked manager would hold the PGLite file open for the next load.
    expect(manager.cleanup).toHaveBeenCalledTimes(1)
    expect(plugin.dbManager).toBeNull()
  })

  it('builds the RAG engine on the same database, once', async () => {
    const manager = createManager()
    mockCreate.mockResolvedValue(manager)
    const plugin = createPlugin()

    const [first, second] = await Promise.all([
      plugin.getRAGEngine(),
      plugin.getRAGEngine(),
    ])

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('cleans up a RAG engine that finished building after unload started', async () => {
    const manager = createManager()
    mockCreate.mockResolvedValue(manager)
    const plugin = createPlugin()
    // Unload lands after the database is up, while the engine is being built.
    manager.getVectorManager.mockImplementation(() => {
      startUnloading(plugin)
      return {}
    })

    await expect(plugin.getRAGEngine()).rejects.toThrow(
      'Aider unloaded during RAG initialization',
    )
    expect(mockRagCleanup).toHaveBeenCalledTimes(1)
    expect(plugin.ragEngine).toBeNull()
  })

  it('propagates a database failure to the RAG engine and retries both', async () => {
    const manager = createManager()
    mockCreate
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce(manager)
    const plugin = createPlugin()

    await expect(plugin.getRAGEngine()).rejects.toThrow('database is locked')
    await expect(plugin.getRAGEngine()).resolves.toBeTruthy()
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })
})
