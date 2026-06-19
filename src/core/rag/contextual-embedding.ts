import { EmbeddingModelClient } from '../../types/embedding'

const VOYAGE_CONTEXTUAL_AUTO_CHUNK_MODELS = new Set(['voyage-context-4'])

export function isVoyageContextualAutoChunkModel(
  embeddingModel: Pick<EmbeddingModelClient, 'model' | 'providerType'>,
): boolean {
  return (
    embeddingModel.providerType === 'voyage' &&
    VOYAGE_CONTEXTUAL_AUTO_CHUNK_MODELS.has(embeddingModel.model)
  )
}
