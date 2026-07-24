jest.mock('./codexAuth', () => {
  const actual = jest.requireActual<typeof import('./codexAuth')>('./codexAuth')
  return { ...actual, refreshCodexAccessToken: jest.fn() }
})
jest.mock('./claudeCodeAuth', () => {
  const actual =
    jest.requireActual<typeof import('./claudeCodeAuth')>('./claudeCodeAuth')
  return { ...actual, refreshClaudeCodeAccessToken: jest.fn() }
})
jest.mock('./geminiAuth', () => {
  const actual =
    jest.requireActual<typeof import('./geminiAuth')>('./geminiAuth')
  return { ...actual, refreshGeminiAccessToken: jest.fn() }
})

import { providerSecretKeys } from '../../security/secret-store/provider-secret-utils'
import { SecretStore } from '../../security/secret-store/secret-store'
import { persistSettingsUpdate } from '../../security/secret-store/settings-secrets'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { LLMProvider } from '../../types/provider.types'

import { AnthropicClaudeCodeProvider } from './anthropicClaudeCodeProvider'
import { refreshClaudeCodeAccessToken } from './claudeCodeAuth'
import { refreshCodexAccessToken } from './codexAuth'
import { refreshGeminiAccessToken } from './geminiAuth'
import { GeminiPlanProvider } from './geminiPlanProvider'
import {
  createProviderUpdateHandler,
  mergeProviderUpdateIntoSettings,
} from './manager'
import { OpenAICodexProvider } from './openaiCodexProvider'

type PlanProvider = Extract<
  LLMProvider,
  { type: 'openai-plan' | 'anthropic-plan' | 'gemini-plan' }
>

function createSettings(provider: PlanProvider): SmartComposerSettings {
  return {
    version: 20,
    providers: [provider],
    chatModels: [
      {
        id: 'chat-model',
        providerId: provider.id,
        providerType: provider.type,
        model: 'plan-model',
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
        approvalPolicy: 'on-request',
        cwdMode: 'vault',
        customCwd: '',
        resume: true,
      },
    },
  }
}

describe('plan provider refresh persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(['openai-plan', 'anthropic-plan', 'gemini-plan'] as const)(
    '%s refreshes local auth state before persisting the new secrets',
    async (type) => {
      const provider: PlanProvider =
        type === 'gemini-plan'
          ? {
              id: type,
              type,
              oauth: {
                accessToken: 'old-access-token',
                refreshToken: 'old-refresh-token',
                expiresAt: 1,
                projectId: 'project-id',
              },
            }
          : {
              id: type,
              type,
              oauth: {
                accessToken: 'old-access-token',
                refreshToken: 'old-refresh-token',
                expiresAt: 1,
              },
            }
      const originalSettings = createSettings(provider)
      let runtimeSettings = originalSettings
      let persistedSettings: SmartComposerSettings | undefined
      const secrets = new Map<string, string>()
      secrets.set(
        providerSecretKeys(provider, 'accessToken').current,
        'old-access-token',
      )
      secrets.set(
        providerSecretKeys(provider, 'refreshToken').current,
        'old-refresh-token',
      )
      const secretStore: SecretStore = {
        getBackendStatus: () => 'obsidian-secret-storage',
        getSecret: async (key) => secrets.get(key) ?? null,
        setSecret: async (key, value) => {
          secrets.set(key, value)
        },
        deleteSecret: async (key) => {
          secrets.delete(key)
        },
      }
      const onProviderUpdate = async (
        providerId: string,
        update: Partial<LLMProvider>,
      ) => {
        const previousSettings = runtimeSettings
        const nextSettings = mergeProviderUpdateIntoSettings(
          previousSettings,
          providerId,
          update,
        )
        await persistSettingsUpdate({
          previousSettings,
          nextSettings,
          secretStore,
          publishRuntimeSettings: (settings) => {
            runtimeSettings = settings
          },
          saveData: async (settings) => {
            persistedSettings = settings
          },
        })
      }

      if (provider.type === 'openai-plan') {
        jest.mocked(refreshCodexAccessToken).mockResolvedValue({
          id_token: '',
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        })
        const client = new OpenAICodexProvider(provider, onProviderUpdate)
        await (
          client as unknown as {
            getAuthHeaders: () => Promise<Record<string, string>>
          }
        ).getAuthHeaders()
      } else if (provider.type === 'anthropic-plan') {
        jest.mocked(refreshClaudeCodeAccessToken).mockResolvedValue({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        })
        const client = new AnthropicClaudeCodeProvider(
          provider,
          onProviderUpdate,
        )
        await (
          client as unknown as {
            getAuthHeaders: () => Promise<Record<string, string>>
          }
        ).getAuthHeaders()
      } else {
        jest.mocked(refreshGeminiAccessToken).mockResolvedValue({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        })
        const client = new GeminiPlanProvider(provider, onProviderUpdate)
        await (
          client as unknown as {
            getAuthContext: () => Promise<{
              headers: Record<string, string>
              projectId: string
            }>
          }
        ).getAuthContext()
      }

      expect(provider.oauth?.accessToken).toBe('old-access-token')
      expect(originalSettings.providers[0]).toBe(provider)
      expect(
        secrets.get(providerSecretKeys(provider, 'accessToken').current),
      ).toBe('new-access-token')
      expect(
        secrets.get(providerSecretKeys(provider, 'refreshToken').current),
      ).toBe('new-refresh-token')
      const persistedProvider = persistedSettings?.providers[0]
      expect(
        persistedProvider && 'oauth' in persistedProvider
          ? persistedProvider.oauth
          : undefined,
      ).toMatchObject({
        accessToken: '',
        refreshToken: '',
      })
    },
  )

  it.each(['openai-plan', 'anthropic-plan', 'gemini-plan'] as const)(
    '%s shares concurrent refresh and does not overwrite newer credentials',
    async (type) => {
      const provider: PlanProvider =
        type === 'gemini-plan'
          ? {
              id: 'shared-provider',
              type,
              oauth: {
                accessToken: 'expired-access-token',
                refreshToken: 'old-refresh-token',
                expiresAt: 1,
                projectId: 'project-id',
              },
            }
          : {
              id: 'shared-provider',
              type,
              oauth: {
                accessToken: 'expired-access-token',
                refreshToken: 'old-refresh-token',
                expiresAt: 1,
              },
            }
      let runtimeSettings = createSettings(provider)
      const onProviderUpdate = createProviderUpdateHandler({
        settings: runtimeSettings,
        getSettings: () => runtimeSettings,
        setSettings: async (update) => {
          runtimeSettings =
            typeof update === 'function' ? update(runtimeSettings) : update
        },
      })
      const refreshedTokens = {
        id_token: '',
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
      }
      let resolveRefresh!: (tokens: typeof refreshedTokens) => void
      const pendingRefresh = new Promise<typeof refreshedTokens>((resolve) => {
        resolveRefresh = resolve
      })
      let refreshMock: jest.Mock
      let requests: Promise<string>[]

      if (provider.type === 'openai-plan') {
        refreshMock = jest.mocked(refreshCodexAccessToken)
        refreshMock.mockReturnValue(pendingRefresh)
        const clients = [
          new OpenAICodexProvider(provider, onProviderUpdate),
          new OpenAICodexProvider(provider, onProviderUpdate),
        ]
        requests = clients.map(async (client) => {
          const headers = await (
            client as unknown as {
              getAuthHeaders: () => Promise<Record<string, string>>
            }
          ).getAuthHeaders()
          return headers.authorization
        })
      } else if (provider.type === 'anthropic-plan') {
        refreshMock = jest.mocked(refreshClaudeCodeAccessToken)
        refreshMock.mockReturnValue(pendingRefresh)
        const clients = [
          new AnthropicClaudeCodeProvider(provider, onProviderUpdate),
          new AnthropicClaudeCodeProvider(provider, onProviderUpdate),
        ]
        requests = clients.map(async (client) => {
          const headers = await (
            client as unknown as {
              getAuthHeaders: () => Promise<Record<string, string>>
            }
          ).getAuthHeaders()
          return headers.authorization
        })
      } else {
        refreshMock = jest.mocked(refreshGeminiAccessToken)
        refreshMock.mockReturnValue(pendingRefresh)
        const clients = [
          new GeminiPlanProvider(provider, onProviderUpdate),
          new GeminiPlanProvider(provider, onProviderUpdate),
        ]
        requests = clients.map(async (client) => {
          const authContext = await (
            client as unknown as {
              getAuthContext: () => Promise<{
                headers: Record<string, string>
                projectId: string
              }>
            }
          ).getAuthContext()
          return authContext.headers.authorization
        })
      }

      await Promise.resolve()
      expect(refreshMock).toHaveBeenCalledTimes(1)

      runtimeSettings = mergeProviderUpdateIntoSettings(
        runtimeSettings,
        provider.id,
        {
          oauth: {
            ...provider.oauth,
            accessToken: 'replacement-access-token',
            refreshToken: 'replacement-refresh-token',
            expiresAt: Date.now() + 3600_000,
          },
        },
      )
      resolveRefresh(refreshedTokens)
      await expect(Promise.all(requests)).resolves.toEqual([
        'Bearer rotated-access-token',
        'Bearer rotated-access-token',
      ])

      const runtimeProvider = runtimeSettings.providers[0]
      expect(
        'oauth' in runtimeProvider ? runtimeProvider.oauth : undefined,
      ).toMatchObject({
        accessToken: 'replacement-access-token',
        refreshToken: 'replacement-refresh-token',
      })
    },
  )

  it('keeps a rotated refresh single-flight locked through persistence', async () => {
    const provider: Extract<PlanProvider, { type: 'openai-plan' }> = {
      id: 'persisting-provider',
      type: 'openai-plan',
      oauth: {
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: 1,
      },
    }
    let markPersistenceStarted!: () => void
    const persistenceStarted = new Promise<void>((resolve) => {
      markPersistenceStarted = resolve
    })
    let releasePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const onProviderUpdate = jest.fn(async () => {
      markPersistenceStarted()
      await persistence
    })
    jest.mocked(refreshCodexAccessToken).mockResolvedValue({
      id_token: '',
      access_token: 'rotated-access-token',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
    })
    const clients = [
      new OpenAICodexProvider(provider, onProviderUpdate),
      new OpenAICodexProvider(provider, onProviderUpdate),
    ]
    const getAuthorization = async (client: OpenAICodexProvider) => {
      const headers = await (
        client as unknown as {
          getAuthHeaders: () => Promise<Record<string, string>>
        }
      ).getAuthHeaders()
      return headers.authorization
    }

    const firstRequest = getAuthorization(clients[0])
    await persistenceStarted
    const secondRequest = getAuthorization(clients[1])
    await Promise.resolve()

    expect(refreshCodexAccessToken).toHaveBeenCalledTimes(1)
    expect(onProviderUpdate).toHaveBeenCalledTimes(1)

    releasePersistence()
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      'Bearer rotated-access-token',
      'Bearer rotated-access-token',
    ])
  })
})
