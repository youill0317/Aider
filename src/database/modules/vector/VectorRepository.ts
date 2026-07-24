import {
  SQL,
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  lt,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import { PgliteDatabase } from 'drizzle-orm/pglite'

import {
  EmbeddingDbStats,
  EmbeddingModelClient,
} from '../../../types/embedding'
import { DatabaseNotInitializedException } from '../../exception'
import {
  InsertEmbedding,
  SelectEmbedding,
  embeddingTable,
  supportedDimensionsForIndex,
} from '../../schema'

export type IndexedVectorFile = Pick<
  SelectEmbedding,
  'path' | 'mtime' | 'metadata' | 'dimension'
>

export class VectorRepository {
  private db: PgliteDatabase | null

  constructor(db: PgliteDatabase | null) {
    this.db = db
  }

  async getIndexedFiles(
    embeddingModel: EmbeddingModelClient,
  ): Promise<IndexedVectorFile[]> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    return this.db
      .selectDistinctOn([embeddingTable.path, embeddingTable.dimension], {
        path: embeddingTable.path,
        mtime: embeddingTable.mtime,
        metadata: embeddingTable.metadata,
        dimension: embeddingTable.dimension,
      })
      .from(embeddingTable)
      .where(eq(embeddingTable.model, embeddingModel.id))
      .orderBy(
        embeddingTable.path,
        embeddingTable.dimension,
        desc(embeddingTable.mtime),
        desc(embeddingTable.id),
      )
  }

  async deleteVectorsForMultipleFiles(
    filePaths: string[],
    embeddingModel: EmbeddingModelClient,
  ): Promise<void> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    await this.db
      .delete(embeddingTable)
      .where(
        and(
          inArray(embeddingTable.path, filePaths),
          eq(embeddingTable.model, embeddingModel.id),
        ),
      )
  }

  async clearAllVectors(modelId: string): Promise<void> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    await this.db
      .delete(embeddingTable)
      .where(eq(embeddingTable.model, modelId))
  }

  async clearAllVectorsForModels(modelIds: string[]): Promise<void> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    if (modelIds.length === 0) return
    await this.db
      .delete(embeddingTable)
      .where(inArray(embeddingTable.model, modelIds))
  }

  async replaceVectorsForFile(
    filePath: string,
    embeddingModel: EmbeddingModelClient,
    data: InsertEmbedding[],
  ): Promise<void> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    await this.db.transaction(async (tx) => {
      await tx
        .delete(embeddingTable)
        .where(
          and(
            eq(embeddingTable.path, filePath),
            eq(embeddingTable.model, embeddingModel.id),
          ),
        )
      if (data.length > 0) {
        await tx.insert(embeddingTable).values(data)
      }
    })
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
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    const indexedDimension = supportedDimensionsForIndex.find(
      (dimension) => dimension === embeddingModel.dimension,
    )
    const embeddingExpression =
      indexedDimension === undefined
        ? embeddingTable.embedding
        : sql`(${embeddingTable.embedding}::vector(${sql.raw(String(indexedDimension))}))`
    const distance = cosineDistance(embeddingExpression, queryVector)
    const similarity = sql<number>`1 - (${distance})`
    const similarityCondition = lt(distance, 1 - options.minSimilarity)

    const getScopeCondition = (): SQL | undefined => {
      if (!options.scope) {
        return undefined
      }
      const conditions: (SQL | undefined)[] = []
      if (options.scope.files.length > 0) {
        conditions.push(inArray(embeddingTable.path, options.scope.files))
      }
      if (options.scope.folders.length > 0) {
        conditions.push(
          or(
            ...options.scope.folders.map(
              (folder) =>
                sql<boolean>`starts_with(${embeddingTable.path}, ${`${folder}/`})`,
            ),
          ),
        )
      }
      if (conditions.length === 0) {
        return undefined
      }
      return or(...conditions)
    }
    const scopeCondition = getScopeCondition()

    const similaritySearchResults = await this.db
      .select({
        ...(() => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { embedding, ...rest } = getTableColumns(embeddingTable)
          return rest
        })(),
        similarity,
      })
      .from(embeddingTable)
      .where(
        and(
          similarityCondition,
          scopeCondition,
          eq(embeddingTable.model, embeddingModel.id),
          eq(embeddingTable.dimension, embeddingModel.dimension), // include this to fully utilize partial index
        ),
      )
      .orderBy(asc(distance))
      .limit(options.limit)

    return similaritySearchResults
  }

  async getEmbeddingStats(): Promise<EmbeddingDbStats[]> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }

    const stats = await this.db
      .select({
        model: embeddingTable.model,
        rowCount: count(),
        totalDataBytes: sum(sql`pg_column_size(${embeddingTable}.*)`).mapWith(
          Number,
        ),
      })
      .from(embeddingTable)
      .groupBy(embeddingTable.model)
      .orderBy(embeddingTable.model)

    return stats
  }
}
