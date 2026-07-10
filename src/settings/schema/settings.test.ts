import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import {
  parseSmartComposerSettings,
  parseSmartComposerSettingsResult,
} from './settings'

describe('parseSmartComposerSettings', () => {
  it('should return default values for empty input', () => {
    const result = parseSmartComposerSettings({})
    expect(result).toEqual({
      version: SETTINGS_SCHEMA_VERSION,

      providers: [...DEFAULT_PROVIDERS],

      chatModels: [...DEFAULT_CHAT_MODELS],
      embeddingModels: [...DEFAULT_EMBEDDING_MODELS],

      chatModelId: DEFAULT_CHAT_MODEL_ID,
      applyModelId: DEFAULT_APPLY_MODEL_ID,
      embeddingModelId: 'openai/text-embedding-3-small',

      systemPrompt: '',

      ragOptions: {
        chunkSize: 1000,
        thresholdTokens: 8192,
        minSimilarity: 0.0,
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
          approvalPolicy: 'never',
          cwdMode: 'vault',
          customCwd: '',
          resume: true,
        },
      },
    })
  })

  it('marks migrated settings as safe to persist', () => {
    const result = parseSmartComposerSettingsResult({})

    expect(result.safeToPersist).toBe(true)
    expect(result.settings.version).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('approves a valid legacy migration for persistence', () => {
    const result = parseSmartComposerSettingsResult({
      ...parseSmartComposerSettings({}),
      version: SETTINGS_SCHEMA_VERSION - 1,
      embeddingModels: [],
    })

    expect(result.safeToPersist).toBe(true)
    expect(result.settings.version).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('uses runtime defaults without approving future settings for overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const storedSettings = {
      version: SETTINGS_SCHEMA_VERSION + 1,
      futureSetting: 'preserve-me',
    }

    const result = parseSmartComposerSettingsResult(storedSettings)

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(storedSettings).toEqual({
      version: SETTINGS_SCHEMA_VERSION + 1,
      futureSetting: 'preserve-me',
    })
  })

  it('uses runtime defaults without approving corrupt settings for overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = parseSmartComposerSettingsResult('corrupt settings')

    expect(result.safeToPersist).toBe(false)
    expect(result.settings).toEqual(parseSmartComposerSettings({}))
  })

  it('detects field fallbacks hidden by the tolerant settings schema', () => {
    const result = parseSmartComposerSettingsResult({
      version: SETTINGS_SCHEMA_VERSION,
      providers: 'corrupt providers',
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.providers).toEqual(DEFAULT_PROVIDERS)
  })

  it('does not approve stripped unknown fields for overwrite', () => {
    const defaults = parseSmartComposerSettings({})
    const topLevel = parseSmartComposerSettingsResult({
      ...defaults,
      futureSetting: 'preserve-me',
    })
    const nested = parseSmartComposerSettingsResult({
      ...defaults,
      ragOptions: {
        ...defaults.ragOptions,
        futureSetting: 'preserve-me',
      },
    })

    expect(topLevel.safeToPersist).toBe(false)
    expect(nested.safeToPersist).toBe(false)
  })
})
