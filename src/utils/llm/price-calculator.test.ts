import { PromptLevel } from '../../types/prompt-level.types'

import { calculateLLMCost } from './price-calculator'

describe('calculateLLMCost', () => {
  it('calculates DeepSeek model usage', () => {
    expect(
      calculateLLMCost({
        model: {
          providerType: 'deepseek',
          providerId: 'deepseek',
          id: 'deepseek-chat',
          model: 'deepseek-chat',
          promptLevel: PromptLevel.Default,
        },
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
      }),
    ).toBeCloseTo(0.7)
  })

  it.each([
    [200_000, 12.4],
    [200_001, 18.800004],
  ])(
    'uses the correct Gemini 3.1 Pro tier for %i prompt tokens',
    (promptTokens, expected) => {
      expect(
        calculateLLMCost({
          model: {
            providerType: 'gemini',
            providerId: 'gemini',
            id: 'gemini-3.1-pro-preview',
            model: 'gemini-3.1-pro-preview',
            promptLevel: PromptLevel.Default,
          },
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: 1_000_000,
            total_tokens: promptTokens + 1_000_000,
          },
        }),
      ).toBeCloseTo(expected)
    },
  )
})
