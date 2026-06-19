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

  const embeddingModelClient: EmbeddingModelClient = {
    id: embeddingModel.id,
    providerType: embeddingModel.providerType,
    model: embeddingModel.model,
    dimension: embeddingModel.dimension,
    getEmbedding: (text: string) =>
      providerClient.getEmbedding(embeddingModel.model, text, {
        dimensions: embeddingModel.outputDimension,
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
      }),
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
