import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import { VectorManager } from '../../database/modules/vector/VectorManager'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'

import { isVoyageContextualAutoChunkModel } from './contextual-embedding'
import { getEmbeddingModelClient } from './embedding'

// TODO: do we really need this class? It seems like unnecessary abstraction.
export class RAGEngine {
  private settings: SmartComposerSettings
  private vectorManager: VectorManager | null = null
  private embeddingModel: EmbeddingModelClient | null = null
  private indexQueue: Promise<void> = Promise.resolve()
  private activeQueries = new Set<Promise<unknown>>()
  private closed = false

  constructor(settings: SmartComposerSettings, vectorManager: VectorManager) {
    this.settings = settings
    this.vectorManager = vectorManager
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  async cleanup() {
    this.closed = true
    await Promise.all([
      this.indexQueue.catch(() => undefined),
      ...[...this.activeQueries].map((query) => query.catch(() => undefined)),
    ])
    this.embeddingModel = null
    this.vectorManager = null
  }

  // TODO: use addSettingsChangeListener
  setSettings(settings: SmartComposerSettings) {
    this.settings = settings
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  // TODO: Implement automatic vault re-indexing when settings are changed.
  // Currently, users must manually re-index the vault.
  async updateVaultIndex(
    options: { reindexAll: boolean } = {
      reindexAll: false,
    },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    const { embeddingModel, vectorManager } = this.getResources()
    const indexOptions = {
      chunkSize: this.settings.ragOptions.chunkSize,
      excludePatterns: [...this.settings.ragOptions.excludePatterns],
      includePatterns: [...this.settings.ragOptions.includePatterns],
      reindexAll: options.reindexAll,
    }

    return this.enqueueIndexUpdate(
      embeddingModel,
      vectorManager,
      indexOptions,
      onQueryProgressChange,
    )
  }

  private enqueueIndexUpdate(
    embeddingModel: EmbeddingModelClient,
    vectorManager: VectorManager,
    indexOptions: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll: boolean
      scope?: { files: string[]; folders: string[] }
    },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    const update = this.indexQueue
      .catch(() => undefined)
      .then(async () => {
        await vectorManager.updateVaultIndex(
          embeddingModel,
          indexOptions,
          (indexProgress) => {
            onQueryProgressChange?.({
              type: 'indexing',
              indexProgress,
            })
          },
        )
      })
    this.indexQueue = update
    return update
  }

  async processQuery({
    query,
    scope,
    onQueryProgressChange,
  }: {
    query: string
    scope?: {
      files: string[]
      folders: string[]
    }
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
  }): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    const { embeddingModel, vectorManager } = this.getResources()
    const ragOptions = this.settings.ragOptions
    const operation = this.processQueryWithSnapshot({
      embeddingModel,
      vectorManager,
      query,
      scope,
      onQueryProgressChange,
      ragOptions: {
        chunkSize: ragOptions.chunkSize,
        excludePatterns: [...ragOptions.excludePatterns],
        includePatterns: [...ragOptions.includePatterns],
        limit: ragOptions.limit,
        minSimilarity: ragOptions.minSimilarity,
      },
    })
    this.activeQueries.add(operation)
    try {
      return await operation
    } finally {
      this.activeQueries.delete(operation)
    }
  }

  private async processQueryWithSnapshot({
    embeddingModel,
    vectorManager,
    query,
    scope,
    onQueryProgressChange,
    ragOptions,
  }: {
    embeddingModel: EmbeddingModelClient
    vectorManager: VectorManager
    query: string
    scope?: { files: string[]; folders: string[] }
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
    ragOptions: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      limit: number
      minSimilarity: number
    }
  }): Promise<(Omit<SelectEmbedding, 'embedding'> & { similarity: number })[]> {
    // TODO: Decide the vault index update strategy.
    // Current approach: Update on every query.
    await this.enqueueIndexUpdate(
      embeddingModel,
      vectorManager,
      { ...ragOptions, reindexAll: false, scope },
      onQueryProgressChange,
    )
    const queryEmbedding = await this.getQueryEmbedding(query, embeddingModel)
    onQueryProgressChange?.({
      type: 'querying',
    })
    const queryResult =
      (await vectorManager.performSimilaritySearch(
        queryEmbedding,
        embeddingModel,
        {
          minSimilarity: ragOptions.minSimilarity,
          limit: ragOptions.limit,
          scope,
        },
      )) ?? []
    onQueryProgressChange?.({
      type: 'querying-done',
      queryResult,
    })
    return queryResult
  }

  private async getQueryEmbedding(
    query: string,
    embeddingModel: EmbeddingModelClient,
  ): Promise<number[]> {
    if (isVoyageContextualAutoChunkModel(embeddingModel)) {
      if (!embeddingModel.getContextualEmbeddings) {
        throw new Error(
          `Embedding model ${embeddingModel.id} does not support contextual query embeddings.`,
        )
      }
      const result = await embeddingModel.getContextualEmbeddings(query, {
        inputType: 'query',
      })
      const firstEmbedding = result.chunks[0]?.embedding
      if (!firstEmbedding || firstEmbedding.length === 0) {
        throw new Error('Contextual query embedding response is empty.')
      }
      return firstEmbedding
    }
    return embeddingModel.getEmbedding(query)
  }

  private getResources(): {
    embeddingModel: EmbeddingModelClient
    vectorManager: VectorManager
  } {
    if (this.closed) {
      throw new Error('RAG engine is closed')
    }
    if (!this.embeddingModel || !this.vectorManager) {
      throw new Error('Embedding model is not set')
    }
    return {
      embeddingModel: this.embeddingModel,
      vectorManager: this.vectorManager,
    }
  }
}
