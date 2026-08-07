import SmartComposerPlugin from './main'
import type { SmartComposerSettings } from './settings/schema/setting.types'
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
  McpManager: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('./database/DatabaseManager', () => ({
  DatabaseManager: { create: jest.fn() },
}))

const mockPersistSettingsUpdate = jest.fn()
jest.mock('./security/secret-store/settings-secrets', () => ({
  hydrateSettingsSecrets: jest.fn(),
  persistRecognizedRawSettingsSecrets: jest.fn(),
  persistSettingsUpdate: (params: unknown) =>
    mockPersistSettingsUpdate(params) as unknown,
  sanitizeSettingsForPersistence: jest.fn(),
}))
jest.mock('./security/secret-store/secret-store', () => ({
  createSecretStore: jest.fn(() => ({})),
}))

type PersistParams = {
  nextSettings: SmartComposerSettings
  publishRuntimeSettings: (settings: SmartComposerSettings) => void
  saveData: (settings: SmartComposerSettings) => Promise<void>
}

const BASE_SETTINGS = smartComposerSettingsSchema.parse({})

/**
 * Builds a plugin with only the fields setSettings touches. Everything the
 * persistence layer would do is replaced by a recorder so the test observes
 * the queue, not the storage.
 */
function createPlugin({
  onPersist,
}: {
  onPersist?: (params: PersistParams) => Promise<void>
} = {}) {
  const steps: string[] = []
  const notified: SmartComposerSettings[] = []

  mockPersistSettingsUpdate.mockImplementation(
    async (params: PersistParams) => {
      steps.push(`persist:${params.nextSettings.systemPrompt}`)
      if (onPersist) await onPersist(params)
      params.publishRuntimeSettings(params.nextSettings)
    },
  )

  const plugin = Object.assign(Object.create(SmartComposerPlugin.prototype), {
    app: {},
    settings: BASE_SETTINGS,
    settingsChangeListeners: [
      (settings: SmartComposerSettings) => {
        steps.push(`notify:${settings.systemPrompt}`)
        notified.push(settings)
      },
    ],
    settingsSaveQueue: null,
    unloading: false,
    ragEngine: null,
    saveData: async () => undefined,
  }) as SmartComposerPlugin

  return { notified, plugin, steps }
}

function withPrompt(prompt: string) {
  return (current: SmartComposerSettings): SmartComposerSettings => ({
    ...current,
    systemPrompt: prompt,
  })
}

describe('SmartComposerPlugin.setSettings queue', () => {
  afterEach(() => {
    mockPersistSettingsUpdate.mockReset()
  })

  it('notifies listeners only after the write is persisted', async () => {
    const { plugin, steps } = createPlugin()

    await plugin.setSettings(withPrompt('model-a'))

    expect(steps).toEqual(['persist:model-a', 'notify:model-a'])
  })

  it('serializes concurrent writes instead of interleaving them', async () => {
    let releaseFirst: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let persistCount = 0
    const { plugin, steps } = createPlugin({
      onPersist: async () => {
        persistCount += 1
        if (persistCount === 1) await firstStarted
      },
    })

    const first = plugin.setSettings(withPrompt('model-a'))
    const second = plugin.setSettings(withPrompt('model-b'))

    // The second write must not touch storage while the first is in flight.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(steps).toEqual(['persist:model-a'])

    releaseFirst?.()
    await Promise.all([first, second])

    expect(steps).toEqual([
      'persist:model-a',
      'notify:model-a',
      'persist:model-b',
      'notify:model-b',
    ])
  })

  it('does not discard a queued write when the one ahead of it fails', async () => {
    let persistCount = 0
    const { plugin, steps } = createPlugin({
      onPersist: async () => {
        persistCount += 1
        if (persistCount === 1) throw new Error('disk full')
      },
    })

    const first = plugin.setSettings(withPrompt('model-a'))
    const second = plugin.setSettings(withPrompt('model-b'))

    await expect(first).rejects.toThrow('disk full')
    await expect(second).resolves.toBeUndefined()

    // model-b must still reach storage even though model-a blew up.
    expect(steps).toEqual([
      'persist:model-a',
      'persist:model-b',
      'notify:model-b',
    ])
  })

  it('builds each queued update from the result of the one before it', async () => {
    const { plugin } = createPlugin()

    const first = plugin.setSettings(withPrompt('model-a'))
    const second = plugin.setSettings((current) => ({
      ...current,
      systemPrompt: `${current.systemPrompt}+b`,
    }))
    await Promise.all([first, second])

    // The second updater ran against model-a, not the pre-queue snapshot.
    expect(plugin.settings.systemPrompt).toBe('model-a+b')
  })

  it('rejects an invalid update without persisting or notifying', async () => {
    const { plugin, steps } = createPlugin()

    await expect(
      plugin.setSettings(() => ({
        ...BASE_SETTINGS,
        chatModelId: 'does-not-exist',
      })),
    ).rejects.toThrow('Invalid settings')

    expect(steps).toEqual([])
  })

  it('lets a later write through after an invalid one is rejected', async () => {
    const { plugin, steps } = createPlugin()

    await expect(
      plugin.setSettings(() => ({
        ...BASE_SETTINGS,
        chatModelId: 'does-not-exist',
      })),
    ).rejects.toThrow('Invalid settings')
    await plugin.setSettings(withPrompt('model-c'))

    expect(steps).toEqual(['persist:model-c', 'notify:model-c'])
  })

  it('refuses to start a write while the plugin is unloading', async () => {
    const { plugin, steps } = createPlugin()
    ;(plugin as unknown as { unloading: boolean }).unloading = true

    await expect(plugin.setSettings(withPrompt('model-a'))).rejects.toThrow(
      'Aider is unloading',
    )
    expect(steps).toEqual([])
  })

  it('leaves an in-flight write observable for unload to await', async () => {
    let releasePersist: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    const { plugin } = createPlugin({ onPersist: () => blocked })

    const pending = plugin.setSettings(withPrompt('model-a'))
    const queue = (plugin as unknown as { settingsSaveQueue: Promise<void> })
      .settingsSaveQueue

    expect(queue).toBeInstanceOf(Promise)
    releasePersist?.()
    await pending
    // Settled writes are cleared so unload does not hold a stale promise.
    expect(
      (plugin as unknown as { settingsSaveQueue: Promise<void> | null })
        .settingsSaveQueue,
    ).toBeNull()
  })
})
