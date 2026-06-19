import { LLMProviderType } from './provider.types'

export type ContextualEmbeddingInputType = 'document' | 'query'

export type ContextualEmbeddingChunk = {
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
  getEmbedding: (text: string) => Promise<number[]>
  getContextualEmbeddings?: (
    text: string,
    options: { inputType: ContextualEmbeddingInputType },
  ) => Promise<ContextualEmbeddingsResult>
}

export type EmbeddingDbStats = {
  model: string
  rowCount: number
  totalDataBytes: number
}
