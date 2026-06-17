import { z } from 'zod'

import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'

import { BaseLLMProvider } from './base'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'

const voyageEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
    }),
  ),
})

export class VoyageProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'voyage' }>
> {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(provider: Extract<LLMProvider, { type: 'voyage' }>) {
    super(provider)
    this.apiKey = provider.apiKey ?? ''
    this.baseUrl = provider.baseUrl
      ? provider.baseUrl.replace(/\/+$/, '')
      : 'https://api.voyageai.com/v1'
  }

  async generateResponse(
    _model: ChatModel,
    _request: LLMRequestNonStreaming,
    _options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    throw new Error(
      `Provider ${this.provider.id} does not support chat responses. Please use it only for embeddings.`,
    )
  }

  async streamResponse(
    _model: ChatModel,
    _request: LLMRequestStreaming,
    _options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    throw new Error(
      `Provider ${this.provider.id} does not support chat responses. Please use it only for embeddings.`,
    )
  }

  async getEmbedding(
    model: string,
    text: string,
    options?: { dimensions?: number },
  ): Promise<number[]> {
    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model,
        ...(options?.dimensions && {
          output_dimension: options.dimensions,
        }),
      }),
    })

    if (response.status === 401 || response.status === 403) {
      throw new LLMAPIKeyInvalidException(
        `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
      )
    }
    if (response.status === 429) {
      throw new LLMRateLimitExceededException(
        'Voyage AI API rate limit exceeded. Please try again later.',
      )
    }
    if (!response.ok) {
      throw new Error(
        `Voyage AI embedding request failed with status ${response.status}.`,
      )
    }

    const parsed = voyageEmbeddingResponseSchema.parse(await response.json())
    const firstEmbedding = parsed.data[0]?.embedding
    if (!firstEmbedding || firstEmbedding.length === 0) {
      throw new Error('Voyage AI embedding response did not include a vector.')
    }

    return firstEmbedding
  }
}
