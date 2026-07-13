import { PgliteDatabase } from 'drizzle-orm/pglite'
import { backOff } from 'exponential-backoff'
import { Minimatch } from 'minimatch'
import { App, EventRef, TAbstractFile, TFile } from 'obsidian'

import { IndexProgress } from '../../../components/chat-view/QueryProgress'
import { ErrorModal } from '../../../components/modals/ErrorModal'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
  LLMRateLimitExceededException,
} from '../../../core/llm/exception'
import { isVoyageContextualAutoChunkModel } from '../../../core/rag/contextual-embedding'
import { InsertEmbedding, SelectEmbedding } from '../../../database/schema'
import {
  EmbeddingDbStats,
  EmbeddingModelClient,
} from '../../../types/embedding'
import { chunkArray } from '../../../utils/common/chunk-array'
import { splitMarkdown } from '../../../utils/markdown-text-splitter'
import {
  createVoyageContextualMetadata,
  getStandardIndexProfile,
  hasMatchingVoyageContextualIndexProfile,
  hasMatchingStandardIndexProfile,
} from '../../vector-metadata'

import { IndexedVectorFile, VectorRepository } from './VectorRepository'

type UpdateVaultIndexOptions = {
  chunkSize: number
  excludePatterns: string[]
  includePatterns: string[]
  reindexAll?: boolean
  scope?: {
    files: string[]
    folders: string[]
  }
  signal?: AbortSignal
}

export class VectorManager {
  private static readonly EMBEDDING_CONCURRENCY = 8
  private static readonly MAX_INDEX_FILE_BYTES = 16 * 1024 * 1024
  private static readonly MAX_CHUNKS_PER_FILE = 2_000
  private app: App
  private repository: VectorRepository
  private saveCallback: (() => Promise<void>) | null = null
  private vacuumCallback: (() => Promise<void>) | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private closed = false
  private vaultRevision = 0
  private lastIndexSnapshot: { key: string; vaultRevision: number } | undefined
  private skippedFileSignatures = new Map<string, string>()
  private vaultEventRefs: EventRef[] = []

  private async requestSave() {
    try {
      if (this.saveCallback) {
        await this.saveCallback()
      } else {
        throw new Error('No save callback set')
      }
    } catch (error) {
      new ErrorModal(
        this.app,
        'Error: save failed',
        'Failed to save the vector database changes. Please report this issue to the developer.',
        error instanceof Error ? error.message : 'Unknown error',
        {
          showReportBugButton: true,
        },
      ).open()
      throw error
    }
  }

  private async requestVacuum() {
    if (this.vacuumCallback) {
      await this.vacuumCallback()
    }
  }

  constructor(app: App, db: PgliteDatabase) {
    this.app = app
    this.repository = new VectorRepository(db)
    if (typeof app.vault.on === 'function') {
      const invalidateMarkdown = (file: TAbstractFile) => {
        if (file.path.toLowerCase().endsWith('.md')) {
          this.vaultRevision += 1
        }
      }
      const invalidateAll = () => {
        this.vaultRevision += 1
      }
      this.vaultEventRefs = [
        app.vault.on('create', invalidateMarkdown),
        app.vault.on('modify', invalidateMarkdown),
        app.vault.on('delete', invalidateAll),
        app.vault.on('rename', invalidateAll),
      ]
    }
  }

  setSaveCallback(callback: () => Promise<void>) {
    this.saveCallback = callback
  }

  setVacuumCallback(callback: () => Promise<void>) {
    this.vacuumCallback = callback
  }

  async performSimilaritySearch(
    queryVector: number[],
    embeddingModel: EmbeddingModelClient,
    options: {
      minSimilarity: number
      limit: number
      scope?: {
        files: string[]
        folders: string[]
      }
    },
  ): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    return await this.repository.performSimilaritySearch(
      validateEmbeddingVector(queryVector, embeddingModel.dimension),
      embeddingModel,
      options,
    )
  }

  async updateVaultIndex(
    embeddingModel: EmbeddingModelClient,
    options: UpdateVaultIndexOptions,
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    return this.enqueueMutation(() =>
      this.updateVaultIndexNow(embeddingModel, options, updateProgress),
    )
  }

  private async updateVaultIndexNow(
    embeddingModel: EmbeddingModelClient,
    options: UpdateVaultIndexOptions,
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    throwIfAborted(options.signal)
    const snapshotKey = this.createIndexSnapshotKey(embeddingModel, options)
    if (
      !options.reindexAll &&
      this.lastIndexSnapshot?.key === snapshotKey &&
      this.lastIndexSnapshot.vaultRevision === this.vaultRevision
    ) {
      return
    }
    const vaultRevision = this.vaultRevision
    const embeddingProfile = this.getEmbeddingProfile(embeddingModel)
    const matchesIndexFilters = this.createIndexFilter(
      options.excludePatterns,
      options.includePatterns,
    )
    const indexedFiles = await this.repository.getIndexedFiles(embeddingModel)
    let indexChanged = await this.deleteVectorsForStaleFiles(
      indexedFiles,
      embeddingModel,
      matchesIndexFilters,
    )
    const filesToIndex = this.getFilesToIndex({
      embeddingModel,
      indexedFiles,
      matchesIndexFilters,
      chunkSize: options.chunkSize,
      embeddingProfile,
      reindexAll: options.reindexAll,
      scope: options.reindexAll ? undefined : options.scope,
    })

    if (filesToIndex.length === 0) {
      if (indexChanged) {
        await this.requestSave()
      }
      this.lastIndexSnapshot = { key: snapshotKey, vaultRevision }
      return
    }

    if (isVoyageContextualAutoChunkModel(embeddingModel)) {
      await this.updateVaultIndexWithContextualAutoChunk({
        embeddingModel,
        filesToIndex,
        embeddingProfile,
        chunkSize: options.chunkSize,
        indexChanged,
        signal: options.signal,
        updateProgress,
      })
      this.lastIndexSnapshot = { key: snapshotKey, vaultRevision }
      return
    }

    let completedChunks = 0
    let totalChunks = filesToIndex.length
    let currentFilePath = filesToIndex[0].path

    updateProgress?.({
      completedChunks,
      totalChunks,
      totalFiles: filesToIndex.length,
    })

    try {
      for (const file of filesToIndex) {
        throwIfAborted(options.signal)
        currentFilePath = file.path
        const sourceMtime = file.stat.mtime
        const sourceSize = file.stat.size
        if (this.isFileTooLarge(sourceSize)) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            options.chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        const fileContent = await this.app.vault.cachedRead(file)
        if (this.isFileTooLarge(new Blob([fileContent]).size)) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            options.chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        const contentChunks = splitMarkdown(
          this.sanitizeFileContent(fileContent),
          options.chunkSize,
        ).map(
          (chunk): Omit<InsertEmbedding, 'model' | 'dimension'> => ({
            path: file.path,
            mtime: file.stat.mtime,
            content: chunk.content,
            metadata: {
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              indexProfile: getStandardIndexProfile({
                chunkSize: options.chunkSize,
                embeddingProfile,
              }),
            },
          }),
        )
        if (contentChunks.length > VectorManager.MAX_CHUNKS_PER_FILE) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            options.chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        if (contentChunks.length === 0) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            options.chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        totalChunks += contentChunks.length - 1
        updateProgress?.({
          completedChunks,
          totalChunks,
          totalFiles: filesToIndex.length,
        })

        const embeddingChunks: InsertEmbedding[] = []
        for (const batchChunk of chunkArray(
          contentChunks,
          VectorManager.EMBEDDING_CONCURRENCY,
        )) {
          const batchEmbeddings = await Promise.all(
            batchChunk.map((chunk) =>
              abortable(
                backOff(
                  async () => {
                    throwIfAborted(options.signal)
                    if (chunk.content.length === 0) {
                      throw new Error(
                        `Chunk content is empty in file: ${chunk.path}`,
                      )
                    }
                    if (chunk.content.includes('\x00')) {
                      // this should never happen because we remove null bytes from the content
                      throw new Error(
                        `Chunk content contains null bytes in file: ${chunk.path}`,
                      )
                    }

                    const embedding = validateEmbeddingVector(
                      await embeddingModel.getEmbedding(
                        chunk.content,
                        options.signal,
                      ),
                      embeddingModel.dimension,
                    )
                    completedChunks += 1

                    updateProgress?.({
                      completedChunks,
                      totalChunks,
                      totalFiles: filesToIndex.length,
                    })

                    return {
                      path: chunk.path,
                      mtime: chunk.mtime,
                      content: chunk.content,
                      model: embeddingModel.id,
                      dimension: embeddingModel.dimension,
                      embedding,
                      metadata: chunk.metadata,
                    }
                  },
                  {
                    numOfAttempts: 8,
                    startingDelay: 2000,
                    timeMultiple: 2,
                    maxDelay: 60000,
                    jitter: 'full',
                    retry: (error) => {
                      if (options.signal?.aborted) return false
                      if (isRateLimitError(error)) {
                        updateProgress?.({
                          completedChunks,
                          totalChunks,
                          totalFiles: filesToIndex.length,
                          waitingForRateLimit: true,
                        })
                        return true
                      }
                      return false
                    },
                  },
                ),
                options.signal,
              ),
            ),
          )
          embeddingChunks.push(...batchEmbeddings)
        }
        if (this.hasFileChanged(file.path, sourceMtime, sourceSize)) {
          this.vaultRevision += 1
          continue
        }
        await this.repository.replaceVectorsForFile(
          file.path,
          embeddingModel,
          embeddingChunks,
        )
        this.skippedFileSignatures.delete(file.path)
        indexChanged = true
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(this.app, 'Error', error.message, undefined, {
          showSettingsButton: true,
        }).open()
      } else {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'

        new ErrorModal(
          this.app,
          'Error: embedding failed',
          `The indexing process was interrupted because several files couldn't be processed.
Please report this issue to the developer if it persists.`,
          `[Error Log]\n\nFile: ${currentFilePath}\nError: ${errorMessage}`,
          {
            showReportBugButton: true,
          },
        ).open()
      }
      throw error
    } finally {
      if (indexChanged) {
        await this.requestSave()
      }
    }
    this.lastIndexSnapshot = { key: snapshotKey, vaultRevision }
  }

  async clearAllVectors(embeddingModel: EmbeddingModelClient): Promise<void> {
    return this.enqueueMutation(() => this.clearAllVectorsNow(embeddingModel))
  }

  private async clearAllVectorsNow(
    embeddingModel: EmbeddingModelClient,
  ): Promise<void> {
    await this.repository.clearAllVectors(embeddingModel)
    this.vaultRevision += 1
    this.lastIndexSnapshot = undefined
    try {
      await this.requestVacuum()
    } finally {
      await this.requestSave()
    }
  }

  async close(): Promise<void> {
    this.closed = true
    await this.mutationQueue
    this.vaultEventRefs.forEach((eventRef) => this.app.vault.offref(eventRef))
    this.vaultEventRefs = []
  }

  private async updateVaultIndexWithContextualAutoChunk({
    embeddingModel,
    filesToIndex,
    embeddingProfile,
    chunkSize,
    indexChanged: initialIndexChanged,
    signal,
    updateProgress,
  }: {
    embeddingModel: EmbeddingModelClient
    filesToIndex: TFile[]
    embeddingProfile: string
    chunkSize: number
    indexChanged: boolean
    signal?: AbortSignal
    updateProgress?: (indexProgress: IndexProgress) => void
  }): Promise<void> {
    let completedFiles = 0
    let currentFilePath = filesToIndex[0].path
    let indexChanged = initialIndexChanged

    updateProgress?.({
      completedChunks: 0,
      totalChunks: filesToIndex.length,
      totalFiles: filesToIndex.length,
    })

    try {
      if (!embeddingModel.getContextualEmbeddings) {
        throw new Error(
          `Embedding model ${embeddingModel.id} does not support contextual document embeddings.`,
        )
      }

      for (const file of filesToIndex) {
        throwIfAborted(signal)
        currentFilePath = file.path
        const sourceMtime = file.stat.mtime
        const sourceSize = file.stat.size
        if (this.isFileTooLarge(sourceSize)) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        const fileContent = await this.app.vault.cachedRead(file)
        if (this.isFileTooLarge(new Blob([fileContent]).size)) {
          await this.replaceWithEmptyIndex(file.path, embeddingModel)
          this.rememberSkippedFile(
            file,
            embeddingModel,
            chunkSize,
            embeddingProfile,
          )
          indexChanged = true
          continue
        }
        const sanitizedContent = this.sanitizeFileContent(fileContent)
        let embeddingChunks: InsertEmbedding[] = []
        if (sanitizedContent.length > 0) {
          const result = await abortable(
            backOff(
              async () =>
                embeddingModel.getContextualEmbeddings?.(sanitizedContent, {
                  inputType: 'document',
                  signal,
                }),
              {
                numOfAttempts: 8,
                startingDelay: 2000,
                timeMultiple: 2,
                maxDelay: 60000,
                jitter: 'full',
                retry: (error) => {
                  if (signal?.aborted) return false
                  if (isRateLimitError(error)) {
                    updateProgress?.({
                      completedChunks: completedFiles,
                      totalChunks: filesToIndex.length,
                      totalFiles: filesToIndex.length,
                      waitingForRateLimit: true,
                    })
                    return true
                  }
                  return false
                },
              },
            ),
            signal,
          )
          if (!result || result.chunks.length === 0) {
            throw new Error(
              `Contextual embedding response did not include chunks for file: ${file.path}`,
            )
          }
          if (result.chunks.length > VectorManager.MAX_CHUNKS_PER_FILE) {
            throw new Error(
              `Contextual embedding response has too many chunks for file: ${file.path}`,
            )
          }

          embeddingChunks = result.chunks.map((chunk) => {
            if (chunk.text.length === 0) {
              throw new Error(
                `Contextual chunk content is empty in file: ${file.path}`,
              )
            }
            if (chunk.text.includes('\x00')) {
              throw new Error(
                `Contextual chunk content contains null bytes in file: ${file.path}`,
              )
            }

            return {
              path: file.path,
              mtime: file.stat.mtime,
              content: chunk.text,
              model: embeddingModel.id,
              dimension: embeddingModel.dimension,
              embedding: validateEmbeddingVector(
                chunk.embedding,
                embeddingModel.dimension,
              ),
              metadata: createVoyageContextualMetadata({
                chunkerVersion: result.chunkerVersion,
                embeddingProfile,
              }),
            }
          })
        }

        if (this.hasFileChanged(file.path, sourceMtime, sourceSize)) {
          this.vaultRevision += 1
          continue
        }
        await this.repository.replaceVectorsForFile(
          file.path,
          embeddingModel,
          embeddingChunks,
        )
        if (embeddingChunks.length === 0) {
          this.rememberSkippedFile(
            file,
            embeddingModel,
            chunkSize,
            embeddingProfile,
          )
        } else {
          this.skippedFileSignatures.delete(file.path)
        }
        indexChanged = true
        completedFiles += 1
        updateProgress?.({
          completedChunks: completedFiles,
          totalChunks: filesToIndex.length,
          totalFiles: filesToIndex.length,
        })
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      new ErrorModal(
        this.app,
        'Error: contextual embedding failed',
        `The indexing process was interrupted because a file couldn't be processed.`,
        `[Error Log]\n\nFile: ${currentFilePath}\nError: ${errorMessage}`,
        {
          showReportBugButton: true,
        },
      ).open()
      throw error
    } finally {
      if (indexChanged) {
        await this.requestSave()
      }
    }
  }

  private async deleteVectorsForStaleFiles(
    indexedFiles: IndexedVectorFile[],
    embeddingModel: EmbeddingModelClient,
    matchesIndexFilters: (filePath: string) => boolean,
  ) {
    const staleFilePaths = [
      ...new Set(indexedFiles.map(({ path }) => path)),
    ].filter(
      (filePath) =>
        !this.app.vault.getAbstractFileByPath(filePath) ||
        !matchesIndexFilters(filePath),
    )
    if (staleFilePaths.length === 0) {
      return false
    }
    await this.repository.deleteVectorsForMultipleFiles(
      staleFilePaths,
      embeddingModel,
    )
    return true
  }

  private getFilesToIndex({
    embeddingModel,
    indexedFiles = [],
    matchesIndexFilters,
    chunkSize,
    embeddingProfile,
    reindexAll,
    scope,
  }: {
    embeddingModel: EmbeddingModelClient
    indexedFiles?: IndexedVectorFile[]
    matchesIndexFilters: (filePath: string) => boolean
    chunkSize: number
    embeddingProfile: string
    reindexAll?: boolean
    scope?: { files: string[]; folders: string[] }
  }): TFile[] {
    let filesToIndex = this.app.vault.getMarkdownFiles()

    filesToIndex = filesToIndex.filter(
      (file) =>
        matchesIndexFilters(file.path) && this.matchesScope(file.path, scope),
    )

    if (reindexAll) {
      return filesToIndex
    }

    const indexedFileByPath = new Map<string, IndexedVectorFile>()
    for (const indexedFile of indexedFiles) {
      if (indexedFile.dimension !== embeddingModel.dimension) continue
      const current = indexedFileByPath.get(indexedFile.path)
      if (!current || indexedFile.mtime > current.mtime) {
        indexedFileByPath.set(indexedFile.path, indexedFile)
      }
    }

    return filesToIndex.filter((file) => {
      if (
        this.skippedFileSignatures.get(file.path) ===
        this.createSkippedFileSignature(
          file,
          embeddingModel,
          chunkSize,
          embeddingProfile,
        )
      ) {
        return false
      }
      const indexedFile = indexedFileByPath.get(file.path)
      if (!indexedFile) {
        return true
      }
      const outOfDate = file.stat.mtime !== indexedFile.mtime
      if (outOfDate) {
        return true
      }
      if (
        isVoyageContextualAutoChunkModel(embeddingModel) &&
        !hasMatchingVoyageContextualIndexProfile({
          embeddingProfile,
          metadata: indexedFile.metadata,
        })
      ) {
        return true
      }
      if (
        !isVoyageContextualAutoChunkModel(embeddingModel) &&
        !hasMatchingStandardIndexProfile({
          indexProfile: getStandardIndexProfile({
            chunkSize,
            embeddingProfile,
          }),
          metadata: indexedFile.metadata,
        })
      ) {
        return true
      }
      return false
    })
  }

  private createIndexFilter(
    excludePatterns: string[],
    includePatterns: string[],
  ): (filePath: string) => boolean {
    const excluded = excludePatterns.map((pattern) => new Minimatch(pattern))
    const included = includePatterns.map((pattern) => new Minimatch(pattern))
    return (filePath) =>
      !excluded.some((matcher) => matcher.match(filePath)) &&
      (included.length === 0 ||
        included.some((matcher) => matcher.match(filePath)))
  }

  private createIndexSnapshotKey(
    embeddingModel: EmbeddingModelClient,
    options: UpdateVaultIndexOptions,
  ): string {
    const scope = options.reindexAll ? undefined : options.scope
    return JSON.stringify([
      embeddingModel.id,
      embeddingModel.dimension,
      this.getEmbeddingProfile(embeddingModel),
      options.chunkSize,
      options.excludePatterns,
      options.includePatterns,
      scope
        ? {
            files: [...scope.files].sort(),
            folders: [...scope.folders].sort(),
          }
        : null,
    ])
  }

  private matchesScope(
    filePath: string,
    scope?: { files: string[]; folders: string[] },
  ): boolean {
    return (
      !scope ||
      (scope.files.length === 0 && scope.folders.length === 0) ||
      scope.files.includes(filePath) ||
      scope.folders.some((folder) => filePath.startsWith(`${folder}/`))
    )
  }

  async getEmbeddingStats(): Promise<EmbeddingDbStats[]> {
    return await this.repository.getEmbeddingStats()
  }

  private sanitizeFileContent(fileContent: string): string {
    // eslint-disable-next-line no-control-regex
    return fileContent.replace(/\x00/g, '')
  }

  private getEmbeddingProfile(embeddingModel: EmbeddingModelClient): string {
    return (
      embeddingModel.indexProfile ??
      JSON.stringify([
        'embedding-client-v1',
        embeddingModel.providerType,
        embeddingModel.id,
        embeddingModel.model,
        embeddingModel.dimension,
      ])
    )
  }

  private isFileTooLarge(size: number | undefined): boolean {
    return typeof size === 'number' && size > VectorManager.MAX_INDEX_FILE_BYTES
  }

  private hasFileChanged(
    path: string,
    expectedMtime: number,
    expectedSize: number | undefined,
  ): boolean {
    const current = this.app.vault.getAbstractFileByPath(path)
    if (
      !current ||
      !('stat' in current) ||
      typeof current.stat !== 'object' ||
      current.stat === null
    ) {
      return true
    }
    const stat = current.stat as { mtime?: unknown; size?: unknown }
    return (
      stat.mtime !== expectedMtime ||
      (typeof expectedSize === 'number' && stat.size !== expectedSize)
    )
  }

  private async replaceWithEmptyIndex(
    path: string,
    embeddingModel: EmbeddingModelClient,
  ): Promise<void> {
    console.warn(
      `Skipping oversized or over-chunked file during indexing: ${path}`,
    )
    await this.repository.replaceVectorsForFile(path, embeddingModel, [])
  }

  private rememberSkippedFile(
    file: TFile,
    embeddingModel: EmbeddingModelClient,
    chunkSize: number,
    embeddingProfile: string,
  ): void {
    this.skippedFileSignatures.delete(file.path)
    this.skippedFileSignatures.set(
      file.path,
      this.createSkippedFileSignature(
        file,
        embeddingModel,
        chunkSize,
        embeddingProfile,
      ),
    )
    if (this.skippedFileSignatures.size <= 10_000) return
    const oldest = this.skippedFileSignatures.keys().next()
    if (!oldest.done) this.skippedFileSignatures.delete(oldest.value)
  }

  private createSkippedFileSignature(
    file: TFile,
    embeddingModel: EmbeddingModelClient,
    chunkSize: number,
    embeddingProfile: string,
  ): string {
    return JSON.stringify([
      file.stat.mtime,
      file.stat.size,
      embeddingModel.id,
      embeddingModel.dimension,
      chunkSize,
      embeddingProfile,
    ])
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Vector manager is closed'))
    }
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function validateEmbeddingVector(
  embedding: number[],
  expectedDimension: number,
): number[] {
  if (
    !Number.isInteger(expectedDimension) ||
    expectedDimension < 1 ||
    expectedDimension > 32_767 ||
    embedding.length !== expectedDimension ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Embedding response has an invalid vector.')
  }
  return embedding
}

function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof LLMRateLimitExceededException ||
    (typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 429)
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError')
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Operation aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}
