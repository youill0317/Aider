import { AssistantToolMessageGroup } from '../../types/chat'
import { ResponseUsage } from '../../types/llm/response'
import { calculateLLMCost } from '../../utils/llm/price-calculator'

export type AssistantResponseSummary = {
  usage: ResponseUsage | null
  estimatedPrice: number | null
  model: string | null
}

export function summarizeAssistantResponses(
  messages: AssistantToolMessageGroup,
): AssistantResponseSummary {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let hasUsage = false
  let estimatedPrice = 0
  let isPriceAvailable = true
  const models = new Map<string, string>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    const model = message.metadata?.model
    if (model) {
      models.set(
        `${model.providerType}:${model.providerId}:${model.model}`,
        model.model,
      )
    }

    const messageUsage = message.metadata?.usage
    if (!messageUsage) continue

    hasUsage = true
    promptTokens += messageUsage.prompt_tokens
    completionTokens += messageUsage.completion_tokens
    totalTokens += messageUsage.total_tokens

    const messageCost = model
      ? calculateLLMCost({ model, usage: messageUsage })
      : null
    if (messageCost === null) {
      isPriceAvailable = false
    } else {
      estimatedPrice += messageCost
    }
  }

  const usage = hasUsage
    ? {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      }
    : null

  return {
    usage,
    estimatedPrice: usage && isPriceAvailable ? estimatedPrice : null,
    model:
      models.size === 0
        ? null
        : models.size === 1
          ? (models.values().next().value ?? null)
          : 'Multiple models',
  }
}
