import { SecretStore } from '../../security/secret-store/secret-store'
import { persistSettingsUpdate } from '../../security/secret-store/settings-secrets'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { LLMProvider } from '../../types/provider.types'

import {
  createProviderUpdateHandler,
  mergeProviderUpdateIntoSettings,
} from './manager'

function createSettings(providers: LLMProvider[]): SmartComposerSettings {
  return {
    version: 20,
    providers,
    chatModels: [
      {
        id: 'chat-model',
        providerId: 'openai-plan',
        providerType: 'openai-plan',
        model: 'gpt-5',
        enable: true,
      },
    ],
    embeddingModels: [],
    chatModelId: 'chat-model',
    applyModelId: 'chat-model',
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

describe('plan provider secret updates', () => {
  it('token refresh updates secret boundary', () => {
    // Given: a plan provider receives refreshed OAuth credentials.
    const settings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          expiresAt: 1,
        },
      },
    ])

    // When: the provider update is merged into settings.
    const updatedSettings = mergeProviderUpdateIntoSettings(
      settings,
      'openai-plan',
      {
        oauth: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    )

    // Then: the refreshed tokens are present for the T7 secret boundary.
    const updatedProvider = updatedSettings.providers[0]
    expect(
      updatedProvider.type === 'openai-plan'
        ? updatedProvider.oauth?.refreshToken
        : undefined,
    ).toBe('new-refresh-token')
  })

  it('concurrent refresh preserves unrelated settings', () => {
    // Given: a refresh started with stale settings before the user changed chat options.
    const staleSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          expiresAt: 1,
        },
      },
    ])
    const latestSettings: SmartComposerSettings = {
      ...staleSettings,
      systemPrompt: 'latest prompt change',
      chatOptions: {
        ...staleSettings.chatOptions,
        enableTools: false,
        maxAutoIterations: 4,
      },
    }

    // When: the refresh update merges into the latest settings snapshot.
    const updatedSettings = mergeProviderUpdateIntoSettings(
      latestSettings,
      'openai-plan',
      {
        oauth: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    )

    // Then: unrelated concurrent settings changes survive the token refresh.
    expect(updatedSettings.systemPrompt).toBe('latest prompt change')
    expect(updatedSettings.chatOptions).toMatchObject({
      enableTools: false,
      maxAutoIterations: 4,
    })
    const updatedProvider = updatedSettings.providers[0]
    expect(
      updatedProvider.type === 'openai-plan'
        ? updatedProvider.oauth?.accessToken
        : undefined,
    ).toBe('new-access-token')
  })

  it('disconnected provider ignores stale OAuth refresh update', () => {
    // Given: latest settings have already disconnected the provider.
    const disconnectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])

    // When: an in-flight refresh tries to merge stale OAuth credentials.
    const updatedSettings = mergeProviderUpdateIntoSettings(
      disconnectedSettings,
      'openai-plan',
      {
        oauth: {
          accessToken: 'stale-access-token',
          refreshToken: 'stale-refresh-token',
          expiresAt: 1_893_456_000_000,
        },
      },
    )

    // Then: disconnect wins and OAuth is not restored.
    const updatedProvider = updatedSettings.providers[0]
    expect(
      updatedProvider.type === 'openai-plan'
        ? updatedProvider.oauth
        : undefined,
    ).toBeUndefined()
  })

  it('provider update handler reads latest settings before merging', async () => {
    // Given: a provider client was created with stale connected settings.
    const staleSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          expiresAt: 1,
        },
      },
    ])
    const latestDisconnectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])
    const savedSettings: SmartComposerSettings[] = []
    const updateHandler = createProviderUpdateHandler({
      settings: staleSettings,
      setSettings: async (nextSettings) => {
        savedSettings.push(nextSettings)
      },
      getSettings: () => latestDisconnectedSettings,
    })

    // When: the in-flight provider refresh completes after disconnect.
    await updateHandler('openai-plan', {
      oauth: {
        accessToken: 'stale-access-token',
        refreshToken: 'stale-refresh-token',
        expiresAt: 1_893_456_000_000,
      },
    })

    // Then: the production update handler uses latest settings and keeps OAuth disconnected.
    const savedProvider = savedSettings[0].providers[0]
    expect(
      savedProvider.type === 'openai-plan' ? savedProvider.oauth : undefined,
    ).toBeUndefined()
  })

  it('settings updates expose disconnect before secret deletion finishes', async () => {
    // Given: disconnect persistence is waiting on async secret deletion.
    let runtimeSettings: SmartComposerSettings | undefined
    const secretStore: SecretStore = {
      getBackendStatus: () => 'obsidian-secret-storage',
      getSecret: async () => null,
      setSecret: async () => undefined,
      deleteSecret: async () => undefined,
    }
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
    const disconnectedSettings = createSettings([
      {
        id: 'openai-plan',
        type: 'openai-plan',
      },
    ])

    // When: the disconnect save is mid-flight.
    const settingsUpdate = persistSettingsUpdate({
      previousSettings: connectedSettings,
      nextSettings: disconnectedSettings,
      secretStore,
      publishRuntimeSettings: (settings) => {
        runtimeSettings = settings
      },
      saveData: async () => undefined,
    })

    // Then: runtime settings must already expose disconnected state.
    const currentProvider = runtimeSettings?.providers[0]
    expect(
      currentProvider?.type === 'openai-plan'
        ? currentProvider.oauth
        : undefined,
    ).toBeUndefined()
    await settingsUpdate
  })
})
