import { z } from 'zod'

import { ChatModel } from '../../types/chat-model.types'
import {
  ContextualEmbeddingInputType,
  ContextualEmbeddingsResult,
} from '../../types/embedding'
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

const VOYAGE_REQUEST_TIMEOUT_MS = 60_000
const MAX_VOYAGE_RESPONSE_BYTES = 8 * 1024 * 1024

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (!Number.isNaN(declaredSize) && declaredSize > MAX_VOYAGE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Voyage AI response exceeded the 8 MiB size limit.')
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_VOYAGE_RESPONSE_BYTES) {
      throw new Error('Voyage AI response exceeded the 8 MiB size limit.')
    }
    return JSON.parse(text) as unknown
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalSize = 0

  try {
    let streamDone = false
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) {
        streamDone = true
        continue
      }

      totalSize += value.byteLength
      if (totalSize > MAX_VOYAGE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Voyage AI response exceeded the 8 MiB size limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function withVoyageRequest<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  handleResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) {
    abortFromCaller()
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timeout = setTimeout(
    () => controller.abort(new Error('Voyage AI request timed out.')),
    VOYAGE_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return await handleResponse(response)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

const voyageEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
    }),
  ),
})

const voyageContextualEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      data: z.array(
        z.object({
          embedding: z.array(z.number()),
          text: z.string().optional(),
        }),
      ),
    }),
  ),
  chunker_version: z.string().optional(),
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
    options?: { dimensions?: number; signal?: AbortSignal },
  ): Promise<number[]> {
    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    return withVoyageRequest(
      `${this.baseUrl}/embeddings`,
      {
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
      },
      options?.signal,
      async (response) => {
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel()
          throw new LLMAPIKeyInvalidException(
            `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
          )
        }
        if (response.status === 429) {
          await response.body?.cancel()
          throw new LLMRateLimitExceededException(
            'Voyage AI API rate limit exceeded. Please try again later.',
          )
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(
            `Voyage AI embedding request failed with status ${response.status}.`,
          )
        }

        const parsed = voyageEmbeddingResponseSchema.parse(
          await readBoundedJson(response),
        )
        const firstEmbedding = parsed.data[0]?.embedding
        if (!firstEmbedding || firstEmbedding.length === 0) {
          throw new Error(
            'Voyage AI embedding response did not include a vector.',
          )
        }

        return firstEmbedding
      },
    )
  }

  async getContextualEmbeddings(
    model: string,
    text: string,
    options: {
      inputType: ContextualEmbeddingInputType
      dimensions?: number
      signal?: AbortSignal
    },
  ): Promise<ContextualEmbeddingsResult> {
    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    return withVoyageRequest(
      `${this.baseUrl}/contextualizedembeddings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [text],
          model,
          input_type: options.inputType,
          ...(options.inputType === 'document' && {
            enable_auto_chunking: true,
          }),
          ...(options.dimensions && {
            output_dimension: options.dimensions,
          }),
        }),
      },
      options.signal,
      async (response) => {
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel()
          throw new LLMAPIKeyInvalidException(
            `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
          )
        }
        if (response.status === 429) {
          await response.body?.cancel()
          throw new LLMRateLimitExceededException(
            'Voyage AI API rate limit exceeded. Please try again later.',
          )
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(
            `Voyage AI contextual embedding request failed with status ${response.status}.`,
          )
        }

        const parsed = voyageContextualEmbeddingResponseSchema.parse(
          await readBoundedJson(response),
        )
        const chunks: ContextualEmbeddingsResult['chunks'] = []
        let hasEmptyEmbedding = false
        for (const item of parsed.data) {
          for (const chunk of item.data) {
            if (chunk.embedding.length === 0) {
              hasEmptyEmbedding = true
            }
            if (options.inputType === 'document' && !chunk.text) {
              throw new Error(
                'Voyage AI contextual document response did not include chunk text.',
              )
            }
            chunks.push({
              embedding: chunk.embedding,
              text: chunk.text ?? text,
            })
          }
        }
        if (chunks.length === 0 || hasEmptyEmbedding) {
          throw new Error(
            'Voyage AI contextual embedding response did not include a vector.',
          )
        }

        return {
          chunks,
          ...(parsed.chunker_version
            ? { chunkerVersion: parsed.chunker_version }
            : {}),
        }
      },
    )
  }
}
