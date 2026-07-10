import { createSecretStore } from '../../security/secret-store/secret-store'
import { sanitizeSettingsForPersistence } from '../../security/secret-store/settings-secrets'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { parseSmartComposerSettings } from './settings'

describe('security baseline protects provider and MCP secret fields', () => {
  it('keeps provider and MCP secrets out of ordinary settings', async () => {
    // Given: current-version settings containing representative fake secrets.
    const storedSettings = {
      version: SETTINGS_SCHEMA_VERSION,
      providers: [
        {
          id: 'openai',
          type: 'openai',
          apiKey: 'sk-baseline-openai-secret',
        },
        {
          id: 'openai-plan',
          type: 'openai-plan',
          oauth: {
            accessToken: 'baseline-access-token',
            refreshToken: 'baseline-refresh-token',
            expiresAt: 1_893_456_000_000,
            accountId: 'account-baseline',
          },
        },
      ],
      mcp: {
        servers: [
          {
            id: 'filesystem',
            enabled: true,
            parameters: {
              command: 'node',
              args: ['server.js'],
              env: {
                GITHUB_PERSONAL_ACCESS_TOKEN:
                  'github-baseline-personal-access-token',
              },
            },
            toolOptions: {},
          },
        ],
      },
    }
    const secretStorageValues = new Map<string, string>()
    const secretStore = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
          setSecret: async (key: string, value: string) => {
            secretStorageValues.set(key, value)
          },
        },
      },
    })

    // When: settings cross the secret persistence boundary.
    const parsedSettings = parseSmartComposerSettings(storedSettings)
    const persistedSettings = await sanitizeSettingsForPersistence(
      parsedSettings,
      secretStore,
    )
    const serializedSettings = JSON.stringify(persistedSettings)

    // Then: provider and MCP secrets are stripped from ordinary settings.
    expect(serializedSettings).not.toContain('sk-baseline-openai-secret')
    expect(serializedSettings).not.toContain('baseline-access-token')
    expect(serializedSettings).not.toContain('baseline-refresh-token')
    expect(serializedSettings).not.toContain(
      'github-baseline-personal-access-token',
    )
    expect([...secretStorageValues.values()].join('\n')).toContain(
      'github-baseline-personal-access-token',
    )
  })
})
