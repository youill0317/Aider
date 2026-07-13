import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

import { EmbeddingModelClient } from '../../../types/embedding'

import { VectorRepository } from './VectorRepository'

type LoggedQuery = {
  query: string
  params: unknown[]
}

const model = (id: string, dimension: number): EmbeddingModelClient =>
  ({ id, dimension }) as EmbeddingModelClient

const createRepository = (rows: unknown[][] = []) => {
  const queries: LoggedQuery[] = []
  const transaction = jest.fn(async function (
    this: PGlite,
    callback: (transactionClient: PGlite) => Promise<unknown>,
  ) {
    return callback(this)
  })
  const client = {
    query: jest.fn().mockResolvedValue({ rows }),
    transaction,
  } as unknown as PGlite
  const repository = new VectorRepository(
    drizzle(client, {
      logger: {
        logQuery(query, params) {
          queries.push({ query: query.replace(/\s+/g, ' ').trim(), params })
        },
      },
    }),
  )
  return { queries, repository, transaction }
}

describe('VectorRepository SQL', () => {
  it('matches the allowlisted HNSW expression and orders raw distance ascending', async () => {
    const { queries, repository } = createRepository()

    await repository.performSimilaritySearch(
      Array.from({ length: 128 }, () => 0),
      model('indexed', 128),
      { minSimilarity: 0.25, limit: 10 },
    )

    expect(queries).toHaveLength(1)
    const [{ query, params }] = queries
    expect(query.match(/::vector\(128\)/g)).toHaveLength(3)
    expect(query).toMatch(
      /where .*::vector\(128\).* < \$\d+.*"model" = \$\d+.*"dimension" = \$\d+/,
    )
    expect(query).toMatch(
      /order by .*::vector\(128\).* <=> \$\d+ asc limit \$\d+$/,
    )
    expect(query).not.toMatch(/order by .*similarity/i)
    expect(params).toContain(0.75)
  })

  it('uses an uncast sequential fallback while preserving similarity and threshold', async () => {
    const { queries, repository } = createRepository([
      [
        1,
        'closest.md',
        1,
        'closest',
        'fallback',
        3,
        { startLine: 1, endLine: 1 },
        1,
      ],
    ])

    const results = await repository.performSimilaritySearch(
      [1, 0, 0],
      model('fallback', 3),
      {
        minSimilarity: -0.5,
        limit: 5,
      },
    )

    expect(queries).toHaveLength(1)
    const [{ query, params }] = queries
    expect(query).not.toContain('::vector(')
    expect(query).toMatch(
      /select .*1 - \("embeddings"\."embedding" <=> \$\d+\) from/,
    )
    expect(query).toMatch(
      /where .*"embedding" <=> \$\d+ < \$\d+.*"model" = \$\d+.*"dimension" = \$\d+/,
    )
    expect(query).toMatch(
      /order by "embeddings"\."embedding" <=> \$\d+ asc limit \$\d+$/,
    )
    expect(params).toContain(1.5)
    expect(results[0].similarity).toBe(1)
  })

  it('treats wildcard characters in folder names as a literal prefix', async () => {
    const { queries, repository } = createRepository()

    await repository.performSimilaritySearch([1, 0, 0], model('folders', 3), {
      minSimilarity: 0.5,
      limit: 10,
      scope: { files: [], folders: ['notes%_'] },
    })

    expect(queries).toHaveLength(1)
    const [{ query, params }] = queries
    expect(query).toMatch(/starts_with\("embeddings"\."path", \$\d+\)/)
    expect(query.toLowerCase()).not.toContain(' like ')
    expect(params).toContain('notes%_/')
  })

  it('selects one deterministic newest freshness row per path and dimension', async () => {
    const { queries, repository } = createRepository()

    await repository.getIndexedFiles(model('freshness', 3))

    expect(queries).toHaveLength(1)
    const [{ query }] = queries
    expect(query).toMatch(
      /^select distinct on \("embeddings"\."path", "embeddings"\."dimension"\)/,
    )
    expect(query).toMatch(
      /order by "embeddings"\."path", "embeddings"\."dimension", "embeddings"\."mtime" desc, "embeddings"\."id" desc$/,
    )
  })

  it('replaces a file inside one transaction and treats empty data as delete-only', async () => {
    const { queries, repository, transaction } = createRepository()
    const embeddingModel = model('replacement', 3)

    await repository.replaceVectorsForFile('note.md', embeddingModel, [
      {
        path: 'note.md',
        mtime: 1,
        content: 'new',
        model: embeddingModel.id,
        dimension: embeddingModel.dimension,
        embedding: [1, 0, 0],
        metadata: { startLine: 1, endLine: 1 },
      },
    ])

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(queries).toHaveLength(2)
    expect(queries[0].query).toMatch(/^delete from "embeddings"/)
    expect(queries[0].params).toEqual(['note.md', embeddingModel.id])
    expect(queries[1].query).toMatch(/^insert into "embeddings"/)

    queries.length = 0
    await repository.replaceVectorsForFile('note.md', embeddingModel, [])

    expect(transaction).toHaveBeenCalledTimes(2)
    expect(queries).toHaveLength(1)
    expect(queries[0].query).toMatch(/^delete from "embeddings"/)
  })
})
