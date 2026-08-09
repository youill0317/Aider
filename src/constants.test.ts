import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  RECOMMENDED_MODELS_FOR_APPLY,
  RECOMMENDED_MODELS_FOR_CHAT,
} from './constants'
import { calculateLLMCost } from './utils/llm/price-calculator'

// settingsSchema rejects a selected model that is missing or disabled, so a
// typo in either default id breaks settings parsing on a fresh install.
describe('default model ids', () => {
  const byId = new Map(DEFAULT_CHAT_MODELS.map((model) => [model.id, model]))

  it.each([
    ['DEFAULT_CHAT_MODEL_ID', DEFAULT_CHAT_MODEL_ID],
    ['DEFAULT_APPLY_MODEL_ID', DEFAULT_APPLY_MODEL_ID],
  ])('%s resolves to an enabled default chat model', (_name, id) => {
    const model = byId.get(id)
    expect(model).toBeDefined()
    expect(model?.enable).not.toBe(false)
  })

  it.each([
    ['RECOMMENDED_MODELS_FOR_CHAT', RECOMMENDED_MODELS_FOR_CHAT],
    ['RECOMMENDED_MODELS_FOR_APPLY', RECOMMENDED_MODELS_FOR_APPLY],
  ])('%s only names known default models', (_name, ids) => {
    for (const id of ids) {
      expect(byId.has(id)).toBe(true)
    }
  })

  it('has no duplicate model ids', () => {
    expect(byId.size).toBe(DEFAULT_CHAT_MODELS.length)
  })
})

// Adding a model without a pricing entry silently degrades the response-info
// popover to "Estimated Price: Not available". Plan providers are excluded on
// purpose — those bill by subscription, so there is no per-token cost to show.
describe('default model pricing', () => {
  const PRICED_PROVIDER_TYPES = [
    'openai',
    'anthropic',
    'gemini',
    'xai',
    'deepseek',
  ]

  const pricedDefaults = DEFAULT_CHAT_MODELS.filter(
    (model) =>
      model.enable !== false &&
      PRICED_PROVIDER_TYPES.includes(model.providerType),
  )

  it('covers every enabled default model on a priced provider', () => {
    const unpriced = pricedDefaults
      .filter(
        (model) =>
          calculateLLMCost({
            model,
            usage: {
              prompt_tokens: 1_000_000,
              completion_tokens: 1_000_000,
              total_tokens: 2_000_000,
            },
          }) === null,
      )
      .map((model) => model.id)

    expect(unpriced).toEqual([])
  })

  it('prices a known model correctly', () => {
    // claude-opus-5 is $5 in / $25 out per 1M tokens.
    const model = DEFAULT_CHAT_MODELS.find((m) => m.id === 'claude-opus-5')
    if (!model) throw new Error('claude-opus-5 missing from defaults')
    expect(
      calculateLLMCost({
        model,
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 200_000,
          total_tokens: 1_200_000,
        },
      }),
    ).toBeCloseTo(10, 6)
  })
})
