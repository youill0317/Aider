import { LLMProviderType } from './provider.types'

export type ContextualEmbeddingInputType = 'document' | 'query'

type ContextualEmbeddingChunk = {
  embedding: number[]
  text: string
}

export type ContextualEmbeddingsResult = {
  chunks: ContextualEmbeddingChunk[]
  chunkerVersion?: string
}

export type EmbeddingModelClient = {
  id: string
  providerType: LLMProviderType
  model: string
  dimension: number
  indexProfile?: string
  getEmbedding: (text: string, signal?: AbortSignal) => Promise<number[]>
  getContextualEmbeddings?: (
    text: string,
    options: {
      inputType: ContextualEmbeddingInputType
      signal?: AbortSignal
    },
  ) => Promise<ContextualEmbeddingsResult>
}

export type EmbeddingDbStats = {
  model: string
  rowCount: number
  totalDataBytes: number
}
