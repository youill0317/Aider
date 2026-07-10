import { App, TFile } from 'obsidian'

import { InsertEmbedding } from '../../schema'

import { VectorManager } from './VectorManager'

describe('VectorManager contextual embedding route', () => {
  it('stores voyage-context-4 returned chunks as file-only rows', async () => {
    const repository = createRepository()
    const app = createApp({
      'notes/context.md': 'First paragraph.\x00\n\nSecond paragraph.',
    })
    const manager = createVectorManager(app, repository)
    const getEmbedding = jest.fn()
    const getContextualEmbeddings = jest.fn().mockResolvedValue({
      chunks: [
        { embedding: [0.1, 0.2], text: 'First paragraph.' },
        { embedding: [0.3, 0.4], text: 'Second paragraph.' },
      ],
      chunkerVersion: 'ctx-v1',
    })

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-context-4',
        providerType: 'voyage',
        model: 'voyage-context-4',
        dimension: 1024,
        getEmbedding,
        getContextualEmbeddings,
      },
      {
        chunkSize: 10,
        excludePatterns: [],
        includePatterns: [],
      },
    )

    expect(getContextualEmbeddings).toHaveBeenCalledWith(
      'First paragraph.\n\nSecond paragraph.',
      { inputType: 'document' },
    )
    expect(getEmbedding).not.toHaveBeenCalled()
    expect(repository.insertedVectors).toHaveLength(2)
    expect(repository.insertedVectors[0]).toMatchObject({
      path: 'notes/context.md',
      content: 'First paragraph.',
      model: 'voyage/voyage-context-4',
      dimension: 1024,
      embedding: [0.1, 0.2],
      metadata: {
        linkMode: 'file-only',
        source: 'voyage-auto-chunk',
        chunkerVersion: 'ctx-v1',
        chunkSizeMode: 'server-default',
      },
    })
    expect(repository.insertedVectors[0]?.metadata).not.toHaveProperty(
      'startLine',
    )
  })

  it('keeps standard models on local chunking and getEmbedding', async () => {
    const repository = createRepository()
    const app = createApp({
      'notes/standard.md': 'Line one\nLine two',
    })
    const manager = createVectorManager(app, repository)
    const getEmbedding = jest.fn().mockResolvedValue([0.5, 0.6])
    const getContextualEmbeddings = jest.fn()

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 1024,
        getEmbedding,
        getContextualEmbeddings,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
      },
    )

    expect(getEmbedding).toHaveBeenCalled()
    expect(getContextualEmbeddings).not.toHaveBeenCalled()
    expect(repository.insertedVectors[0]?.metadata).toEqual({
      startLine: 1,
      endLine: 2,
    })
  })

  it('uses one index snapshot and batches deleted paths', async () => {
    const repository = createRepository()
    repository.getIndexedFiles.mockResolvedValue([
      { path: 'notes/current.md', mtime: 100, metadata: {}, dimension: 1024 },
      { path: 'notes/current.md', mtime: 100, metadata: {}, dimension: 1024 },
      { path: 'notes/deleted.md', mtime: 90, metadata: {}, dimension: 768 },
    ])
    const manager = createVectorManager(
      createApp({ 'notes/current.md': 'Unchanged' }),
      repository,
    )
    const getEmbedding = jest.fn()

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 1024,
        getEmbedding,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
      },
    )

    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(1)
    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledTimes(1)
    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
      ['notes/deleted.md'],
      expect.objectContaining({ id: 'voyage/voyage-4' }),
    )
    expect(getEmbedding).not.toHaveBeenCalled()
  })

  it('deletes and saves indexed files excluded by current filters', async () => {
    const repository = createRepository()
    repository.getIndexedFiles.mockResolvedValue([
      { path: 'private/secret.md', mtime: 100, metadata: {}, dimension: 1024 },
    ])
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(
      createApp({ 'private/secret.md': 'Secret' }),
      repository,
      save,
    )

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 1024,
        getEmbedding: jest.fn(),
      },
      {
        chunkSize: 1000,
        excludePatterns: ['private/**'],
        includePatterns: [],
      },
    )

    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
      ['private/secret.md'],
      expect.objectContaining({ id: 'voyage/voyage-4' }),
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves a full-index clear when no files remain to index', async () => {
    const repository = createRepository()
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(createApp({}), repository, save)

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 1024,
        getEmbedding: jest.fn(),
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
        reindexAll: true,
      },
    )

    expect(repository.clearAllVectors).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

function createVectorManager(
  app: App,
  repository: ReturnType<typeof createRepository>,
  saveCallback = jest.fn().mockResolvedValue(undefined),
): VectorManager {
  const manager = new VectorManager(app, undefined as never)
  Object.assign(manager as unknown as { repository: unknown }, { repository })
  manager.setSaveCallback(saveCallback)
  return manager
}

function createRepository() {
  return {
    insertedVectors: [] as InsertEmbedding[],
    getIndexedFiles: jest.fn().mockResolvedValue([]),
    deleteVectorsForMultipleFiles: jest.fn().mockResolvedValue(undefined),
    clearAllVectors: jest.fn().mockResolvedValue(undefined),
    insertVectors: jest.fn(async function (
      this: { insertedVectors: InsertEmbedding[] },
      vectors: InsertEmbedding[],
    ) {
      this.insertedVectors.push(...vectors)
    }),
  }
}

function createApp(contents: Record<string, string>): App {
  const files = Object.keys(contents).map((filePath) => createFile(filePath))
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file: TFile) => contents[file.path] ?? '',
      getAbstractFileByPath: (filePath: string) =>
        files.find((file) => file.path === filePath) ?? null,
    },
  } as App
}

function createFile(filePath: string): TFile {
  return {
    path: filePath,
    stat: {
      mtime: 100,
    },
  } as TFile
}
