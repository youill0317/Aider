import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ContextualEmbeddingInputType,
  ContextualEmbeddingsResult,
  EmbeddingModelClient,
} from '../../types/embedding'
import { getProviderClient } from '../llm/manager'

import { isVoyageContextualAutoChunkModel } from './contextual-embedding'

type ContextualEmbeddingProvider = {
  getContextualEmbeddings: (
    model: string,
    text: string,
    options: {
      inputType: ContextualEmbeddingInputType
      dimensions?: number
      signal?: AbortSignal
    },
  ) => Promise<ContextualEmbeddingsResult>
}

export const getEmbeddingModelClient = ({
  settings,
  embeddingModelId,
}: {
  settings: SmartComposerSettings
  embeddingModelId: string
}): EmbeddingModelClient => {
  const embeddingModel = settings.embeddingModels.find(
    (model) => model.id === embeddingModelId,
  )
  if (!embeddingModel) {
    throw new Error(`Embedding model ${embeddingModelId} not found`)
  }

  const providerClient = getProviderClient({
    settings,
    providerId: embeddingModel.providerId,
  })
  const provider = settings.providers.find(
    ({ id }) => id === embeddingModel.providerId,
  )
  if (!provider) {
    throw new Error(`Provider ${embeddingModel.providerId} not found`)
  }

  const embeddingModelClient: EmbeddingModelClient = {
    id: embeddingModel.id,
    providerType: embeddingModel.providerType,
    model: embeddingModel.model,
    dimension: embeddingModel.dimension,
    indexProfile: JSON.stringify([
      'embedding-source-v1',
      provider.type,
      provider.id,
      embeddingModel.model,
      embeddingModel.dimension,
      embeddingModel.outputDimension ?? null,
      getPublicBaseUrl(provider.baseUrl),
    ]),
    getEmbedding: (text: string, signal?: AbortSignal) =>
      providerClient.getEmbedding(embeddingModel.model, text, {
        dimensions: embeddingModel.outputDimension,
        ...(signal && { signal }),
      }),
  }

  if (!isVoyageContextualAutoChunkModel(embeddingModelClient)) {
    return embeddingModelClient
  }

  if (!hasContextualEmbeddings(providerClient)) {
    throw new Error(
      `Provider ${embeddingModel.providerId} does not support contextual embeddings.`,
    )
  }

  return {
    ...embeddingModelClient,
    getContextualEmbeddings: (text, options) =>
      providerClient.getContextualEmbeddings(embeddingModel.model, text, {
        dimensions: embeddingModel.outputDimension,
        inputType: options.inputType,
        ...(options.signal && { signal: options.signal }),
      }),
  }
}

function getPublicBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null
  try {
    const url = new URL(baseUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return baseUrl.split(/[?#]/, 1)[0].replace(/\/\/[^/@]*@/, '//')
  }
}

function hasContextualEmbeddings(
  providerClient: unknown,
): providerClient is ContextualEmbeddingProvider {
  return (
    typeof providerClient === 'object' &&
    providerClient !== null &&
    'getContextualEmbeddings' in providerClient &&
    typeof providerClient.getContextualEmbeddings === 'function'
  )
}
