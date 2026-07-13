import { chatModelSchema } from './chat-model.types'

const baseModel = {
  providerId: 'provider',
  id: 'model',
  model: 'upstream-model',
}

describe('chatModelSchema', () => {
  it.each([1023, 1024.5])(
    'rejects invalid Anthropic thinking budget %s',
    (budget_tokens) => {
      expect(
        chatModelSchema.safeParse({
          ...baseModel,
          providerType: 'anthropic',
          thinking: { enabled: true, budget_tokens },
        }).success,
      ).toBe(false)
    },
  )

  it('accepts the minimum Anthropic thinking budget', () => {
    expect(
      chatModelSchema.safeParse({
        ...baseModel,
        providerType: 'anthropic-plan',
        thinking: { enabled: true, budget_tokens: 1024 },
      }).success,
    ).toBe(true)
  })

  it.each([-1, 0, 1])(
    'accepts Gemini thinking budget %s',
    (thinking_budget) => {
      expect(
        chatModelSchema.safeParse({
          ...baseModel,
          providerType: 'gemini',
          thinking: { enabled: true, thinking_budget },
        }).success,
      ).toBe(true)
    },
  )

  it.each([-2, 1.5])('rejects Gemini thinking budget %s', (thinking_budget) => {
    expect(
      chatModelSchema.safeParse({
        ...baseModel,
        providerType: 'gemini-plan',
        thinking: { enabled: true, thinking_budget },
      }).success,
    ).toBe(false)
  })

  it('rejects unsupported OpenAI reasoning options', () => {
    expect(
      chatModelSchema.safeParse({
        ...baseModel,
        providerType: 'openai-plan',
        reasoning: {
          reasoning_effort: 'extreme',
          reasoning_summary: 'full',
        },
      }).success,
    ).toBe(false)
  })

  it('accepts supported OpenAI reasoning options', () => {
    expect(
      chatModelSchema.safeParse({
        ...baseModel,
        providerType: 'openai-plan',
        reasoning: {
          reasoning_effort: 'xhigh',
          reasoning_summary: 'detailed',
        },
      }).success,
    ).toBe(true)
  })

  it('rejects unsupported Perplexity search context sizes', () => {
    expect(
      chatModelSchema.safeParse({
        ...baseModel,
        providerType: 'perplexity',
        web_search_options: { search_context_size: 'extreme' },
      }).success,
    ).toBe(false)
  })
})
