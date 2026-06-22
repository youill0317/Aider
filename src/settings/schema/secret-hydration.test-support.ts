import {
  createSecretStore,
  createSecretStoreKey,
} from '../../security/secret-store/secret-store'
import type { SecretStore } from '../../security/secret-store/secret-store'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { SmartComposerSettings } from './setting.types'

export const AIDER_OPENAI_API_KEY = createSecretStoreKey({
  providerId: 'openai',
  providerType: 'openai',
  field: 'apiKey',
})
export const LEGACY_OPENAI_API_KEY =
  'smart-composer-provider-id-006f-0070-0065-006e-0061-0069-openai-api-key'
export const AIDER_OPENAI_PLAN_ACCESS_TOKEN = createSecretStoreKey({
  providerId: 'openai-plan',
  providerType: 'openai-plan',
  field: 'accessToken',
})
export const AIDER_OPENAI_PLAN_REFRESH_TOKEN = createSecretStoreKey({
  providerId: 'openai-plan',
  providerType: 'openai-plan',
  field: 'refreshToken',
})
export const LEGACY_OPENAI_PLAN_ACCESS_TOKEN =
  'smart-composer-provider-id-006f-0070-0065-006e-0061-0069-002d-0070-006c-0061-006e-openai-plan-access-token'
export const LEGACY_OPENAI_PLAN_REFRESH_TOKEN =
  'smart-composer-provider-id-006f-0070-0065-006e-0061-0069-002d-0070-006c-0061-006e-openai-plan-refresh-token'

export function createTestSettings(): SmartComposerSettings {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    providers: [
      {
        id: 'openai',
        type: 'openai',
        apiKey: 'sk-test-openai-secret',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiresAt: 1_893_456_000_000,
          accountId: 'account-id',
        },
      },
    ],
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

export function createObsidianSecretStore() {
  const secretStorageValues = new Map<string, string>()

  return createSecretStore({
    app: {
      secretStorage: {
        getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
        setSecret: async (key: string, value: string) => {
          secretStorageValues.set(key, value)
        },
      },
    },
  })
}

export function createPersistedSettingsWithoutSecrets(): SmartComposerSettings {
  const settings = createTestSettings()
  return {
    ...settings,
    providers: [
      {
        id: 'openai',
        type: 'openai',
      },
      {
        id: 'openai-plan',
        type: 'openai-plan',
        oauth: {
          accessToken: '',
          refreshToken: '',
          expiresAt: 1_893_456_000_000,
          accountId: 'account-id',
        },
      },
    ],
  }
}

export function createMapBackedSecretStore(
  values: Map<string, string>,
  setSecret: SecretStore['setSecret'] = async (key, value) => {
    values.set(key, value)
  },
): SecretStore {
  return {
    getBackendStatus: () => 'obsidian-secret-storage',
    getSecret: async (key) => values.get(key) ?? null,
    setSecret,
    deleteSecret: async (key) => {
      values.delete(key)
    },
  }
}
