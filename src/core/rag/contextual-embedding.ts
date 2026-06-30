import { EmbeddingModelClient } from '../../types/embedding'

const VOYAGE_CONTEXTUAL_AUTO_CHUNK_MODEL = 'voyage-context-4'

export function isVoyageContextualAutoChunkModel(
  embeddingModel: Pick<EmbeddingModelClient, 'model' | 'providerType'>,
): boolean {
  return (
    embeddingModel.providerType === 'voyage' &&
    embeddingModel.model === VOYAGE_CONTEXTUAL_AUTO_CHUNK_MODEL
  )
}
