import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { MAX_MCP_SERVERS } from './setting.types'
import { parseSmartComposerSettingsResult } from './settings'

const parseSmartComposerSettings = (data: unknown) =>
  parseSmartComposerSettingsResult(data).settings

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
          approvalPolicy: 'on-request',
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
    })

    expect(result.safeToPersist).toBe(true)
    expect(result.settings.version).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('preserves a custom provider route that collides with later chat defaults', () => {
    const defaults = parseSmartComposerSettings({})
    const customProvider = {
      type: 'openai-compatible' as const,
      id: 'morph',
      baseUrl: 'https://private.example/v1',
    }
    const customModel = {
      providerType: 'openai-compatible' as const,
      providerId: 'morph',
      id: 'private-morph',
      model: 'private-model',
    }
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      version: 2,
      providers: [
        ...defaults.providers.filter(({ id }) => id !== customProvider.id),
        customProvider,
      ],
      chatModels: [
        ...defaults.chatModels.filter(
          ({ providerId }) => providerId !== customProvider.id,
        ),
        customModel,
      ],
      chatModelId: customModel.id,
      applyModelId: customModel.id,
    })

    expect(result.safeToPersist).toBe(true)
    expect(
      result.settings.providers.find(({ id }) => id === customProvider.id),
    ).toEqual(customProvider)
    expect(result.settings.chatModels).toContainEqual(customModel)
    expect(result.settings.chatModels.some(({ id }) => id === 'morph-v0')).toBe(
      false,
    )
  })

  it('uses the first provider when deduplicating a legacy collision', () => {
    const defaults = parseSmartComposerSettings({})
    const customProvider = {
      type: 'openai-compatible' as const,
      id: 'deepseek',
      baseUrl: 'https://private.example/v1',
    }
    const customModel = {
      providerType: 'openai-compatible' as const,
      providerId: 'deepseek',
      id: 'private-deepseek',
      model: 'private-model',
    }
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      version: 2,
      providers: [
        ...defaults.providers.filter(({ id }) => id !== customProvider.id),
        customProvider,
        { type: 'deepseek', id: 'deepseek' },
      ],
      chatModels: [
        ...defaults.chatModels.filter(
          ({ providerId }) => providerId !== customProvider.id,
        ),
        customModel,
      ],
    })

    expect(result.safeToPersist).toBe(true)
    expect(
      result.settings.providers.filter(({ id }) => id === customProvider.id),
    ).toEqual([customProvider])
    expect(result.settings.chatModels).toContainEqual(customModel)
    expect(
      result.settings.chatModels.some(
        ({ id }) => id === 'deepseek-chat' || id === 'deepseek-reasoner',
      ),
    ).toBe(false)
  })

  it('preserves a custom provider route that collides with Voyage defaults', () => {
    const defaults = parseSmartComposerSettings({})
    const customProvider = {
      type: 'openai-compatible' as const,
      id: 'voyage',
      baseUrl: 'https://private.example/v1',
    }
    const customModel = {
      providerType: 'openai-compatible' as const,
      providerId: 'voyage',
      id: 'private-voyage',
      model: 'private-embedding',
      dimension: 384,
    }
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      version: 17,
      providers: [
        ...defaults.providers.filter(({ id }) => id !== customProvider.id),
        customProvider,
      ],
      embeddingModels: [
        ...defaults.embeddingModels.filter(
          ({ providerId }) => providerId !== customProvider.id,
        ),
        customModel,
      ],
      embeddingModelId: customModel.id,
    })

    expect(result.safeToPersist).toBe(true)
    expect(
      result.settings.providers.find(({ id }) => id === customProvider.id),
    ).toEqual(customProvider)
    expect(result.settings.embeddingModels).toContainEqual(customModel)
    expect(
      result.settings.embeddingModels.some(
        ({ providerId, providerType }) =>
          providerId === customProvider.id && providerType === 'voyage',
      ),
    ).toBe(false)
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

  it('fails safe for invalid Codex permission settings', () => {
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      agent: {
        codex: {
          ...defaults.agent.codex,
          approvalPolicy: 'invalid',
          defaultSandbox: 'invalid',
        },
      },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.agent.codex).toMatchObject({
      approvalPolicy: 'on-request',
      defaultSandbox: 'read-only',
      enabled: true,
    })
  })

  it('disables Codex when its stored settings object is corrupt', () => {
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      agent: { codex: 'corrupt' },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.agent.codex).toMatchObject({
      approvalPolicy: 'on-request',
      defaultSandbox: 'read-only',
      enabled: false,
    })
  })

  it('normalizes the removed default Codex approval policy', () => {
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      agent: {
        codex: {
          ...defaults.agent.codex,
          approvalPolicy: 'default',
        },
      },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.agent.codex.approvalPolicy).toBe('on-request')
  })

  it('bounds settings that control indexing and automatic tool loops', () => {
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      ragOptions: {
        ...defaults.ragOptions,
        chunkSize: 201,
        thresholdTokens: -1,
        minSimilarity: 2,
        limit: 0,
      },
      chatOptions: {
        ...defaults.chatOptions,
        maxAutoIterations: 1_000,
      },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.ragOptions).toMatchObject({
      chunkSize: 1000,
      thresholdTokens: 8192,
      minSimilarity: 0,
      limit: 10,
    })
    expect(result.settings.chatOptions.maxAutoIterations).toBe(1)
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

  it('rejects duplicate provider IDs without approving an overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      providers: [
        { id: 'duplicate', type: 'openai', apiKey: 'first' },
        { id: 'duplicate', type: 'anthropic', apiKey: 'second' },
      ],
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.providers).toEqual(DEFAULT_PROVIDERS)
  })

  it('rejects duplicate chat model IDs without approving an overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const defaults = parseSmartComposerSettings({})
    const model = defaults.chatModels[0]
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      chatModels: [model, { ...model }],
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.chatModels).toEqual(DEFAULT_CHAT_MODELS)
  })

  it('rejects duplicate embedding model IDs without approving an overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const defaults = parseSmartComposerSettings({})
    const model = defaults.embeddingModels[0]
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      embeddingModels: [model, { ...model }],
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.embeddingModels).toEqual(DEFAULT_EMBEDDING_MODELS)
  })

  it('rejects duplicate MCP server IDs without approving an overwrite', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const defaults = parseSmartComposerSettings({})
    const server = {
      id: 'duplicate',
      enabled: true,
      parameters: { command: 'node' },
      toolOptions: {},
    }
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      mcp: {
        servers: [server, { ...server, parameters: { command: 'deno' } }],
      },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.mcp.servers).toEqual([])
  })

  it.each(['chatModelId', 'applyModelId', 'embeddingModelId'] as const)(
    'rejects a dangling %s',
    (field) => {
      const defaults = parseSmartComposerSettings({})

      expect(
        parseSmartComposerSettingsResult({
          ...defaults,
          [field]: 'missing-model',
        }).safeToPersist,
      ).toBe(false)
    },
  )

  it.each(['chatModelId', 'applyModelId'] as const)(
    'rejects a disabled selected %s',
    (field) => {
      const defaults = parseSmartComposerSettings({})
      const selectedId = defaults[field]

      expect(
        parseSmartComposerSettingsResult({
          ...defaults,
          chatModels: defaults.chatModels.map((model) =>
            model.id === selectedId ? { ...model, enable: false } : model,
          ),
        }).safeToPersist,
      ).toBe(false)
    },
  )

  it.each(['chatModels', 'embeddingModels'] as const)(
    'rejects a missing provider referenced by %s',
    (field) => {
      const defaults = parseSmartComposerSettings({})

      expect(
        parseSmartComposerSettingsResult({
          ...defaults,
          [field]: defaults[field].map((model, index) =>
            index === 0 ? { ...model, providerId: 'missing-provider' } : model,
          ),
        }).safeToPersist,
      ).toBe(false)
    },
  )

  it.each(['chatModels', 'embeddingModels'] as const)(
    'rejects a provider type mismatch in %s',
    (field) => {
      const defaults = parseSmartComposerSettings({})
      const model = defaults[field][0]
      const mismatchedProvider = defaults.providers.find(
        (provider) => provider.type !== model.providerType,
      )
      expect(mismatchedProvider).toBeDefined()

      expect(
        parseSmartComposerSettingsResult({
          ...defaults,
          [field]: defaults[field].map((current, index) =>
            index === 0
              ? { ...current, providerId: mismatchedProvider?.id }
              : current,
          ),
        }).safeToPersist,
      ).toBe(false)
    },
  )

  it('does not allow settings to spawn an unbounded number of MCP servers', () => {
    const defaults = parseSmartComposerSettings({})
    const result = parseSmartComposerSettingsResult({
      ...defaults,
      mcp: {
        servers: Array.from({ length: MAX_MCP_SERVERS + 1 }, (_, index) => ({
          id: `server-${index}`,
          enabled: true,
          parameters: { command: 'node' },
          toolOptions: {},
        })),
      },
    })

    expect(result.safeToPersist).toBe(false)
    expect(result.settings.mcp.servers).toEqual([])
  })
})
