import { ChatAssistantMessage } from '../../types/chat'
import { ChatModel } from '../../types/chat-model.types'

import { summarizeAssistantResponses } from './assistant-response-summary'

const openAIModel: ChatModel = {
  providerType: 'openai',
  providerId: 'openai',
  id: 'gpt',
  model: 'gpt-4o-mini',
}
const anthropicModel: ChatModel = {
  providerType: 'anthropic',
  providerId: 'anthropic',
  id: 'claude',
  model: 'claude-haiku-4-5',
}

function assistant(
  id: string,
  model: ChatModel | undefined,
  promptTokens: number,
  completionTokens: number,
): ChatAssistantMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    metadata: {
      model,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
  }
}

describe('summarizeAssistantResponses', () => {
  it('sums each response using its own model price', () => {
    const summary = summarizeAssistantResponses([
      assistant('one', openAIModel, 1_000_000, 0),
      assistant('two', anthropicModel, 1_000_000, 0),
    ])

    expect(summary.usage).toEqual({
      prompt_tokens: 2_000_000,
      completion_tokens: 0,
      total_tokens: 2_000_000,
    })
    expect(summary.estimatedPrice).toBe(1.15)
    expect(summary.model).toBe('Multiple models')
  })

  it('does not show a misleading partial price', () => {
    const summary = summarizeAssistantResponses([
      assistant('priced', openAIModel, 1_000, 0),
      assistant('unknown', undefined, 1_000, 0),
    ])

    expect(summary.estimatedPrice).toBeNull()
  })
})
