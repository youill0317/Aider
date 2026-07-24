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
})
