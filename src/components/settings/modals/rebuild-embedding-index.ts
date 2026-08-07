import { EmbeddingModelClient } from '../../../types/embedding'
import { IndexProgress } from '../../chat-view/QueryProgress'

/**
 * Rebuilding an embedding index, kept out of the modal component so its
 * concurrency and cancellation rules are testable without rendering.
 *
 * Two rules matter:
 *
 *   1. One rebuild per model. A second click while a rebuild is in flight is
 *      dropped, so the same vault is not re-indexed twice into one table.
 *   2. Closing the modal aborts every in-flight rebuild, and nothing touches
 *      component state after that -- neither progress updates nor the error
 *      notice for the abort the unmount itself caused.
 */

type VectorManager = {
  updateVaultIndex: (
    embeddingModel: EmbeddingModelClient,
    options: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll: boolean
      signal: AbortSignal
    },
    updateProgress?: (progress: IndexProgress) => void,
  ) => Promise<void>
}

export async function rebuildEmbeddingIndex({
  controllers,
  getEmbeddingModel,
  getVectorManager,
  isMounted,
  modelId,
  onError,
  ragOptions,
  refetch,
  setProgress,
}: {
  controllers: Map<string, AbortController>
  getEmbeddingModel: () => EmbeddingModelClient
  getVectorManager: () => Promise<VectorManager>
  isMounted: () => boolean
  modelId: string
  onError: (error: unknown) => void
  ragOptions: {
    chunkSize: number
    excludePatterns: string[]
    includePatterns: string[]
  }
  refetch: () => Promise<unknown>
  setProgress: (modelId: string, progress: IndexProgress | null) => void
}): Promise<void> {
  if (controllers.has(modelId)) return
  const abortController = new AbortController()
  controllers.set(modelId, abortController)
  setProgress(modelId, {
    completedChunks: 0,
    totalChunks: 1,
    totalFiles: 0,
  })
  try {
    const embeddingModel = getEmbeddingModel()

    await (
      await getVectorManager()
    ).updateVaultIndex(
      embeddingModel,
      {
        chunkSize: ragOptions.chunkSize,
        excludePatterns: ragOptions.excludePatterns,
        includePatterns: ragOptions.includePatterns,
        reindexAll: true,
        signal: abortController.signal,
      },
      (progress) => {
        if (!isMounted() || abortController.signal.aborted) return
        setProgress(modelId, progress)
      },
    )
  } catch (error) {
    if (
      abortController.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return
    }
    onError(error)
  } finally {
    controllers.delete(modelId)
    if (isMounted()) {
      setProgress(modelId, null)
      await refetch()
    }
  }
}
