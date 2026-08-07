import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { LLMProvider } from '../../types/provider.types'

import {
  deleteEmbeddingModel,
  deleteMcpServer,
  deleteProvider,
  resetSettings,
} from './destructive-actions'

const PROVIDER = { id: 'openai', type: 'openai' } as unknown as LLMProvider

function buildSettings(
  overrides: Partial<SmartComposerSettings> = {},
): SmartComposerSettings {
  return {
    providers: [PROVIDER, { id: 'anthropic', type: 'anthropic' }],
    chatModels: [
      { id: 'gpt', providerId: 'openai', enable: true },
      { id: 'claude', providerId: 'anthropic', enable: true },
    ],
    embeddingModels: [
      { id: 'openai-embed', providerId: 'openai' },
      { id: 'other-embed', providerId: 'anthropic' },
    ],
    chatModelId: 'gpt',
    applyModelId: 'gpt',
    embeddingModelId: 'other-embed',
    mcp: { servers: [{ id: 'github' }, { id: 'slack' }] },
    ...overrides,
  } as unknown as SmartComposerSettings
}

/**
 * Records every destructive step in call order so a test can assert the
 * sequence, not just that each step happened.
 */
function createHarness({
  settings = buildSettings(),
  setSettingsFails = false,
  revokeFails = false,
  embeddingStats = [{ model: 'openai-embed', rowCount: 12 }],
}: {
  settings?: SmartComposerSettings
  setSettingsFails?: boolean
  revokeFails?: boolean
  embeddingStats?: { model: string; rowCount: number }[]
} = {}) {
  const steps: string[] = []
  let stored = settings

  const vectorManager = {
    clearAllVectors: async (modelId: string) => {
      steps.push(`clearAllVectors:${modelId}`)
    },
    clearAllVectorsForModels: async (modelIds: string[]) => {
      steps.push(`clearAllVectorsForModels:${modelIds.join(',')}`)
    },
    getEmbeddingStats: async () => embeddingStats,
  }

  const plugin = {
    getDbManager: async () => ({ getVectorManager: () => vectorManager }),
    revokeMcpServerTrust: async (serverId: string) => {
      steps.push(`revokeMcpServerTrust:${serverId}`)
      if (revokeFails) throw new Error('trust revocation failed')
    },
    revokeProviderRouteTrust: async (provider: LLMProvider) => {
      steps.push(`revokeProviderRouteTrust:${provider.id}`)
      if (revokeFails) throw new Error('trust revocation failed')
    },
  }

  const setSettings = async (
    update: (current: SmartComposerSettings) => SmartComposerSettings,
  ) => {
    const next = update(stored)
    if (setSettingsFails) {
      steps.push('setSettings:rejected')
      throw new Error('settings write failed')
    }
    stored = next
    steps.push('setSettings:persisted')
  }

  return { plugin, setSettings, settings, steps, stored: () => stored }
}

describe('deleteProvider', () => {
  it('revokes trust, persists the removal, then clears rebuildable vectors', async () => {
    const harness = createHarness()

    await deleteProvider({
      onCleanupError: () => undefined,
      plugin: harness.plugin,
      provider: PROVIDER,
      setSettings: harness.setSettings,
    })

    expect(harness.steps).toEqual([
      'revokeProviderRouteTrust:openai',
      'setSettings:persisted',
      'clearAllVectorsForModels:openai-embed',
    ])
  })

  it('keeps the vectors when the settings write fails', async () => {
    const harness = createHarness({ setSettingsFails: true })

    await expect(
      deleteProvider({
        onCleanupError: () => undefined,
        plugin: harness.plugin,
        provider: PROVIDER,
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('settings write failed')

    // Embeddings are only safe to delete once the removal is durable.
    expect(harness.steps).not.toContain('clearAllVectorsForModels:openai-embed')
  })

  it('does not persist the removal when trust revocation fails', async () => {
    const harness = createHarness({ revokeFails: true })

    await expect(
      deleteProvider({
        onCleanupError: () => undefined,
        plugin: harness.plugin,
        provider: PROVIDER,
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('trust revocation failed')

    expect(harness.steps).toEqual(['revokeProviderRouteTrust:openai'])
  })

  it('skips models that hold no embeddings', async () => {
    const harness = createHarness({
      embeddingStats: [{ model: 'openai-embed', rowCount: 0 }],
    })

    await deleteProvider({
      onCleanupError: () => undefined,
      plugin: harness.plugin,
      provider: PROVIDER,
      setSettings: harness.setSettings,
    })

    expect(harness.steps).toContain('clearAllVectorsForModels:')
  })

  it('reports a cleanup failure without undoing the removal', async () => {
    const harness = createHarness()
    harness.plugin.getDbManager = async () => {
      throw new Error('database unavailable')
    }
    const cleanupErrors: unknown[] = []

    await expect(
      deleteProvider({
        onCleanupError: (error) => cleanupErrors.push(error),
        plugin: harness.plugin,
        provider: PROVIDER,
        setSettings: harness.setSettings,
      }),
    ).resolves.toBeUndefined()

    expect(harness.steps).toContain('setSettings:persisted')
    expect(cleanupErrors).toHaveLength(1)
  })

  it('refuses to delete the last provider that backs a usable model', async () => {
    const harness = createHarness({
      settings: buildSettings({
        providers: [PROVIDER],
        chatModels: [{ id: 'gpt', providerId: 'openai', enable: true }],
        embeddingModels: [{ id: 'openai-embed', providerId: 'openai' }],
      } as Partial<SmartComposerSettings>),
    })

    await expect(
      deleteProvider({
        onCleanupError: () => undefined,
        plugin: harness.plugin,
        provider: PROVIDER,
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('Cannot delete the last available model provider')

    expect(harness.steps).not.toContain('clearAllVectorsForModels:openai-embed')
  })
})

describe('deleteEmbeddingModel', () => {
  it('persists the removal before clearing the vectors', async () => {
    const harness = createHarness()

    await deleteEmbeddingModel({
      modelId: 'openai-embed',
      onCleanupError: () => undefined,
      plugin: harness.plugin,
      setSettings: harness.setSettings,
    })

    expect(harness.steps).toEqual([
      'setSettings:persisted',
      'clearAllVectors:openai-embed',
    ])
  })

  it('keeps the vectors when the settings write fails', async () => {
    const harness = createHarness({ setSettingsFails: true })

    await expect(
      deleteEmbeddingModel({
        modelId: 'openai-embed',
        onCleanupError: () => undefined,
        plugin: harness.plugin,
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('settings write failed')

    expect(harness.steps).not.toContain('clearAllVectors:openai-embed')
  })

  it('refuses to remove the model that is currently selected', async () => {
    const harness = createHarness()

    await expect(
      deleteEmbeddingModel({
        modelId: 'other-embed',
        onCleanupError: () => undefined,
        plugin: harness.plugin,
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('Cannot remove a model that is currently selected')

    expect(harness.steps).toEqual([])
  })

  it('leaves an empty index alone', async () => {
    const harness = createHarness({
      embeddingStats: [{ model: 'openai-embed', rowCount: 0 }],
    })

    await deleteEmbeddingModel({
      modelId: 'openai-embed',
      onCleanupError: () => undefined,
      plugin: harness.plugin,
      setSettings: harness.setSettings,
    })

    expect(harness.steps).toEqual(['setSettings:persisted'])
  })
})

describe('deleteMcpServer', () => {
  it('revokes command trust before removing the server', async () => {
    const harness = createHarness()

    await deleteMcpServer({
      plugin: harness.plugin,
      serverId: 'github',
      setSettings: harness.setSettings,
    })

    expect(harness.steps).toEqual([
      'revokeMcpServerTrust:github',
      'setSettings:persisted',
    ])
    expect(harness.stored().mcp.servers.map(({ id }) => id)).toEqual(['slack'])
  })

  it('keeps the server listed when trust revocation fails', async () => {
    const harness = createHarness({ revokeFails: true })

    await expect(
      deleteMcpServer({
        plugin: harness.plugin,
        serverId: 'github',
        setSettings: harness.setSettings,
      }),
    ).rejects.toThrow('trust revocation failed')

    // A removed server with a surviving trust grant would silently re-trust
    // itself if the user ever adds the same command back.
    expect(harness.steps).toEqual(['revokeMcpServerTrust:github'])
    expect(harness.stored().mcp.servers.map(({ id }) => id)).toEqual([
      'github',
      'slack',
    ])
  })
})

describe('resetSettings', () => {
  it('revokes every provider and server grant before writing defaults', async () => {
    const harness = createHarness()
    const defaults = buildSettings({ providers: [] })

    await resetSettings({
      defaultSettings: defaults,
      plugin: harness.plugin,
      setSettings: harness.setSettings,
      settings: harness.settings,
    })

    expect(harness.steps.at(-1)).toBe('setSettings:persisted')
    expect(harness.steps.slice(0, -1).sort()).toEqual([
      'revokeMcpServerTrust:github',
      'revokeMcpServerTrust:slack',
      'revokeProviderRouteTrust:anthropic',
      'revokeProviderRouteTrust:openai',
    ])
  })

  it('does not write defaults when a grant cannot be revoked', async () => {
    const harness = createHarness({ revokeFails: true })

    await expect(
      resetSettings({
        defaultSettings: buildSettings(),
        plugin: harness.plugin,
        setSettings: harness.setSettings,
        settings: harness.settings,
      }),
    ).rejects.toThrow('trust revocation failed')

    expect(harness.steps).not.toContain('setSettings:persisted')
  })
})
