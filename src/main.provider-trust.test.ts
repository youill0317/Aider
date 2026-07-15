import SmartComposerPlugin from './main'
import { SmartComposerSettings } from './settings/schema/setting.types'
import { LLMProvider } from './types/provider.types'

jest.mock('./ApplyView', () => ({ ApplyView: jest.fn() }))
jest.mock('./ChatView', () => ({ ChatView: jest.fn() }))
jest.mock('./settings/SettingTab', () => ({
  SmartComposerSettingTab: jest.fn(),
}))

describe('provider settings route trust', () => {
  const previousProvider: LLMProvider = {
    id: 'custom',
    type: 'openai-compatible',
    baseUrl: 'https://old.example/v1',
  }
  const nextProvider: LLMProvider = {
    ...previousProvider,
    baseUrl: 'https://new.example/v1',
  }

  it('trusts the new route before saving settings', async () => {
    const calls: string[] = []
    const plugin = createPlugin([previousProvider], {
      setSettings: async () => {
        calls.push('save')
      },
      trustProviderRoute: async () => {
        calls.push('trust')
      },
    })

    await plugin.setTrustedProviderSettings(
      nextProvider,
      settingsWith(nextProvider),
      previousProvider,
    )

    expect(calls).toEqual(['trust', 'save'])
  })

  it('restores the previous route trust when persistence fails', async () => {
    const failure = new Error('save failed')
    const trustProviderRoute = jest.fn().mockResolvedValue(undefined)
    const plugin = createPlugin([previousProvider], {
      setSettings: jest.fn().mockRejectedValue(failure),
      trustProviderRoute,
    })

    await expect(
      plugin.setTrustedProviderSettings(
        nextProvider,
        settingsWith(nextProvider),
        previousProvider,
      ),
    ).rejects.toBe(failure)
    expect(trustProviderRoute).toHaveBeenNthCalledWith(1, nextProvider)
    expect(trustProviderRoute).toHaveBeenNthCalledWith(2, previousProvider)
  })

  it('revokes a new provider route when persistence fails', async () => {
    const revokeProviderRouteTrust = jest.fn().mockResolvedValue(undefined)
    const plugin = createPlugin([], {
      revokeProviderRouteTrust,
      setSettings: jest.fn().mockRejectedValue(new Error('save failed')),
    })

    await expect(
      plugin.setTrustedProviderSettings(
        nextProvider,
        settingsWith(nextProvider),
      ),
    ).rejects.toThrow('save failed')
    expect(revokeProviderRouteTrust).toHaveBeenCalledWith(nextProvider)
  })

  it('keeps new route trust when a later runtime refresh fails', async () => {
    const failure = new Error('refresh failed')
    const trustProviderRoute = jest.fn().mockResolvedValue(undefined)
    const plugin = createPlugin([previousProvider], {
      setSettings: async (settings) => {
        plugin.settings = settings
        throw failure
      },
      trustProviderRoute,
    })

    await expect(
      plugin.setTrustedProviderSettings(
        nextProvider,
        settingsWith(nextProvider),
        previousProvider,
      ),
    ).rejects.toBe(failure)
    expect(trustProviderRoute).toHaveBeenCalledTimes(1)
    expect(trustProviderRoute).toHaveBeenCalledWith(nextProvider)
  })
})

function settingsWith(...providers: LLMProvider[]): SmartComposerSettings {
  return { providers } as SmartComposerSettings
}

function createPlugin(
  providers: LLMProvider[],
  overrides: {
    revokeProviderRouteTrust?: (provider: LLMProvider) => Promise<void>
    setSettings: (settings: SmartComposerSettings) => Promise<void>
    trustProviderRoute?: (provider: LLMProvider) => Promise<void>
  },
): SmartComposerPlugin {
  return Object.assign(Object.create(SmartComposerPlugin.prototype), {
    settings: settingsWith(...providers),
    revokeProviderRouteTrust: jest.fn().mockResolvedValue(undefined),
    trustProviderRoute: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as SmartComposerPlugin
}
