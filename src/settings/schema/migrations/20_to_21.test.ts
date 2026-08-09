import { migrateFrom20To21 } from './20_to_21'

type MigratedChatModel = {
  id: string
  model: string
  enable?: boolean
  thinking?: unknown
}

// hasCompatibleProviderRoute drops any model whose provider is absent, so a
// realistic fixture has to list them.
const ALL_PROVIDERS = [
  { type: 'anthropic-plan', id: 'anthropic-plan' },
  { type: 'openai-plan', id: 'openai-plan' },
  { type: 'gemini-plan', id: 'gemini-plan' },
  { type: 'anthropic', id: 'anthropic' },
  { type: 'openai', id: 'openai' },
  { type: 'gemini', id: 'gemini' },
]

const chatModelsOf = (result: Record<string, unknown>) =>
  result.chatModels as MigratedChatModel[]

describe('Migration from v20 to v21', () => {
  it('should increment version to 21', () => {
    expect(migrateFrom20To21({ version: 20 }).version).toBe(21)
  })

  it('should add the refreshed model line-up', () => {
    const result = migrateFrom20To21({
      version: 20,
      providers: ALL_PROVIDERS,
      chatModels: [],
    })

    const ids = chatModelsOf(result).map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'claude-opus-5',
        'claude-opus-5 (plan)',
        'gpt-5.6-sol',
        'gpt-5.6-luna',
        'gpt-5.3-codex-spark',
        'gemini-3.1-pro-preview',
        'gemini-3.6-flash',
      ]),
    )
  })

  it('should not give claude-opus-5 a thinking budget', () => {
    // budget_tokens is rejected with a 400 on this model.
    const result = migrateFrom20To21({
      version: 20,
      providers: ALL_PROVIDERS,
      chatModels: [],
    })

    for (const model of chatModelsOf(result)) {
      if (model.model === 'claude-opus-5') {
        expect(model.thinking).toBeUndefined()
      }
    }
  })

  it('should ship gpt-5.3-codex-spark disabled', () => {
    const result = migrateFrom20To21({
      version: 20,
      providers: ALL_PROVIDERS,
      chatModels: [],
    })

    const spark = chatModelsOf(result).find(
      (m) => m.id === 'gpt-5.3-codex-spark',
    )
    expect(spark?.enable).toBe(false)
  })

  it('should preserve models the user already had', () => {
    const result = migrateFrom20To21({
      version: 20,
      providers: ALL_PROVIDERS,
      chatModels: [
        {
          id: 'claude-sonnet-4.5',
          providerType: 'anthropic',
          providerId: 'anthropic',
          model: 'claude-sonnet-4-5',
        },
        {
          id: 'my-model',
          providerType: 'custom',
          providerId: 'custom',
          model: 'my-model',
        },
      ],
    })

    const ids = chatModelsOf(result).map((m) => m.id)
    expect(ids).toContain('claude-sonnet-4.5')
    expect(ids).toContain('my-model')
  })

  it('should skip models whose provider is not configured', () => {
    const result = migrateFrom20To21({
      version: 20,
      providers: [{ type: 'anthropic', id: 'anthropic' }],
      chatModels: [],
    })

    const ids = chatModelsOf(result).map((m) => m.id)
    expect(ids).toContain('claude-opus-5')
    expect(ids).not.toContain('gpt-5.6-sol')
  })
})
