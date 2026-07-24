import { App, TFile, TFolder } from 'obsidian'

import { LLMRateLimitExceededException } from '../../../core/llm/exception'
import { InsertEmbedding } from '../../schema'
import { getStandardIndexProfile } from '../../vector-metadata'

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
        dimension: 2,
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
      { inputType: 'document', signal: expect.any(AbortSignal) },
    )
    expect(getEmbedding).not.toHaveBeenCalled()
    expect(repository.insertedVectors).toHaveLength(2)
    expect(repository.insertedVectors[0]).toMatchObject({
      path: 'notes/context.md',
      content: 'First paragraph.',
      model: 'voyage/voyage-context-4',
      dimension: 2,
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

  it('preserves a contextual file when its replacement fails', async () => {
    const repository = createRepository()
    const oldVectors: InsertEmbedding[] = ['first.md', 'second.md'].map(
      (path) => ({
        path,
        mtime: 99,
        content: `old ${path}`,
        model: 'voyage/voyage-context-4',
        dimension: 2,
        embedding: [0.1, 0.2],
        metadata: { startLine: 1, endLine: 1 },
      }),
    )
    repository.insertedVectors.push(...oldVectors)
    repository.getIndexedFiles.mockResolvedValue(
      oldVectors.map(({ path, mtime, metadata, dimension }) => ({
        path,
        mtime,
        metadata,
        dimension,
      })),
    )
    const manager = createVectorManager(
      createApp({ 'first.md': 'first', 'second.md': 'second' }),
      repository,
    )
    const getContextualEmbeddings = jest.fn(async (content: string) => {
      if (content === 'second') throw new Error('context failed')
      return {
        chunks: [{ embedding: [0.3, 0.4], text: content }],
        chunkerVersion: 'ctx-v1',
      }
    })

    await expect(
      manager.updateVaultIndex(
        {
          id: 'voyage/voyage-context-4',
          providerType: 'voyage',
          model: 'voyage-context-4',
          dimension: 2,
          getEmbedding: jest.fn(),
          getContextualEmbeddings,
        },
        {
          chunkSize: 1000,
          excludePatterns: [],
          includePatterns: [],
        },
      ),
    ).rejects.toThrow('context failed')

    expect(repository.replaceVectorsForFile).toHaveBeenCalledTimes(1)
    expect(repository.replaceVectorsForFile).toHaveBeenCalledWith(
      'first.md',
      expect.objectContaining({ id: 'voyage/voyage-context-4' }),
      [expect.objectContaining({ path: 'first.md', content: 'first' })],
    )
    expect(
      repository.insertedVectors.find(({ path }) => path === 'second.md')
        ?.content,
    ).toBe('old second.md')
  })

  it('keeps standard models on local chunking and getEmbedding', async () => {
    const repository = createRepository()
    repository.insertedVectors.push({
      path: 'notes/standard.md',
      mtime: 99,
      content: 'Old content',
      model: 'voyage/voyage-4',
      dimension: 2,
      embedding: [0.1, 0.2],
      metadata: { startLine: 1, endLine: 1 },
    })
    repository.getIndexedFiles.mockResolvedValue([
      {
        path: 'notes/standard.md',
        mtime: 99,
        metadata: { startLine: 1, endLine: 1 },
        dimension: 2,
      },
    ])
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
        dimension: 2,
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
    expect(repository.insertedVectors).toHaveLength(1)
    expect(repository.insertedVectors[0]?.content).toBe('Line one\nLine two')
    expect(repository.insertedVectors[0]?.metadata).toMatchObject({
      startLine: 1,
      endLine: 2,
    })
  })

  it.each([
    { caseName: 'wrong-dimension', embedding: [0.5] },
    { caseName: 'non-finite', embedding: [0.5, Number.NaN] },
  ])(
    'rejects a $caseName embedding before replacing the file index',
    async ({ embedding }) => {
      const repository = createRepository()
      const manager = createVectorManager(
        createApp({ 'notes/invalid.md': 'Content' }),
        repository,
      )

      await expect(
        manager.updateVaultIndex(
          {
            id: 'voyage/voyage-4',
            providerType: 'voyage',
            model: 'voyage-4',
            dimension: 2,
            getEmbedding: jest.fn().mockResolvedValue(embedding),
          },
          {
            chunkSize: 1000,
            excludePatterns: [],
            includePatterns: [],
          },
        ),
      ).rejects.toThrow('Embedding response has an invalid vector.')

      expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    },
  )

  it('preserves the previous file index and rejects when embedding fails', async () => {
    const repository = createRepository()
    const oldVector: InsertEmbedding = {
      path: 'notes/failing.md',
      mtime: 99,
      content: 'Old content',
      model: 'voyage/voyage-4',
      dimension: 2,
      embedding: [0.1, 0.2],
      metadata: { startLine: 1, endLine: 1 },
    }
    repository.insertedVectors.push(oldVector)
    repository.getIndexedFiles.mockResolvedValue([
      {
        path: oldVector.path,
        mtime: oldVector.mtime,
        metadata: oldVector.metadata,
        dimension: oldVector.dimension,
      },
    ])
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(
      createApp({ 'notes/failing.md': 'New content' }),
      repository,
      save,
    )

    await expect(
      manager.updateVaultIndex(
        {
          id: 'voyage/voyage-4',
          providerType: 'voyage',
          model: 'voyage-4',
          dimension: 2,
          getEmbedding: jest.fn().mockRejectedValue(new Error('embed failed')),
        },
        {
          chunkSize: 1000,
          excludePatterns: [],
          includePatterns: [],
        },
      ),
    ).rejects.toThrow('embed failed')

    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    expect(repository.deleteVectorsForMultipleFiles).not.toHaveBeenCalled()
    expect(repository.insertedVectors).toEqual([oldVector])
    expect(save).not.toHaveBeenCalled()
  })

  it('deletes an emptied file through an atomic empty replacement', async () => {
    const repository = createRepository()
    repository.insertedVectors.push({
      path: 'notes/empty.md',
      mtime: 99,
      content: 'Old content',
      model: 'voyage/voyage-4',
      dimension: 2,
      embedding: [0.1, 0.2],
      metadata: { startLine: 1, endLine: 1 },
    })
    repository.getIndexedFiles.mockResolvedValue([
      {
        path: 'notes/empty.md',
        mtime: 99,
        metadata: { startLine: 1, endLine: 1 },
        dimension: 2,
      },
    ])
    const manager = createVectorManager(
      createApp({ 'notes/empty.md': '' }),
      repository,
    )
    const getEmbedding = jest.fn()
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding,
    }

    await manager.updateVaultIndex(embeddingModel, {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
    })

    expect(getEmbedding).not.toHaveBeenCalled()
    expect(repository.replaceVectorsForFile).toHaveBeenCalledWith(
      'notes/empty.md',
      embeddingModel,
      [],
    )
    expect(repository.insertedVectors).toEqual([])
  })

  it('finishes replacing one file before processing the next', async () => {
    const repository = createRepository()
    const app = createApp({
      'first.md': 'first',
      'second.md': 'second',
    })
    const manager = createVectorManager(app, repository)
    const getEmbedding = jest.fn().mockResolvedValue([0.5, 0.6])

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
      },
    )

    expect(repository.replaceVectorsForFile).toHaveBeenCalledTimes(2)
    expect(
      repository.replaceVectorsForFile.mock.invocationCallOrder[0],
    ).toBeLessThan(getEmbedding.mock.invocationCallOrder[1])
  })

  it('embeds only files inside a query scope', async () => {
    const repository = createRepository()
    const manager = createVectorManager(
      createApp({
        'picked.md': 'picked',
        'notes/inside.md': 'inside',
        'notes-copy/outside.md': 'outside sibling',
        'private/secret.md': 'outside vault file',
      }),
      repository,
    )
    const getEmbedding = jest.fn().mockResolvedValue([0.5, 0.6])

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
        scope: { files: ['picked.md'], folders: ['notes'] },
      },
    )

    expect(getEmbedding).toHaveBeenCalledTimes(2)
    expect(getEmbedding).toHaveBeenNthCalledWith(
      1,
      'picked',
      expect.any(AbortSignal),
    )
    expect(getEmbedding).toHaveBeenNthCalledWith(
      2,
      'inside',
      expect.any(AbortSignal),
    )
    expect(repository.insertedVectors.map(({ path }) => path)).toEqual([
      'picked.md',
      'notes/inside.md',
    ])
  })

  it('uses one index snapshot and batches deleted paths', async () => {
    const repository = createRepository()
    const embeddingProfile = JSON.stringify([
      'embedding-client-v1',
      'voyage',
      'voyage/voyage-4',
      'voyage-4',
      2,
    ])
    repository.getIndexedFiles.mockResolvedValue([
      {
        path: 'notes/current.md',
        mtime: 100,
        metadata: {
          indexProfile: getStandardIndexProfile({
            chunkSize: 1000,
            embeddingProfile,
          }),
        },
        dimension: 2,
      },
      {
        path: 'notes/current.md',
        mtime: 100,
        metadata: {
          indexProfile: getStandardIndexProfile({
            chunkSize: 1000,
            embeddingProfile,
          }),
        },
        dimension: 2,
      },
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
        dimension: 2,
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

  it('deletes rebuilt paths occupied by folders or non-Markdown files', async () => {
    const repository = createRepository()
    repository.getIndexedFiles.mockResolvedValue([
      { path: 'folder.md', mtime: 90, metadata: {}, dimension: 2 },
      { path: 'attachment.png', mtime: 90, metadata: {}, dimension: 2 },
    ])
    const app = createApp({})
    jest
      .spyOn(app.vault, 'getAbstractFileByPath')
      .mockImplementation((path) =>
        path === 'folder.md'
          ? ({ path, children: [] } as unknown as TFolder)
          : ({ path, extension: 'png' } as TFile),
      )
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(app, repository, save)

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding: jest.fn(),
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
        reindexAll: true,
      },
    )

    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
      ['folder.md', 'attachment.png'],
      expect.objectContaining({ id: 'voyage/voyage-4' }),
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('deletes and saves indexed files excluded by current filters', async () => {
    const repository = createRepository()
    repository.getIndexedFiles.mockResolvedValue([
      { path: 'private/secret.md', mtime: 100, metadata: {}, dimension: 2 },
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
        dimension: 2,
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

  it('does not clear the full index before a rebuild', async () => {
    const repository = createRepository()
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(
      createApp({ 'current.md': 'Current' }),
      repository,
      save,
    )
    const getEmbedding = jest.fn().mockResolvedValue([0.5, 0.6])

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
        reindexAll: true,
      },
    )

    expect(repository.clearAllVectors).not.toHaveBeenCalled()
    expect(repository.replaceVectorsForFile).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('reindexes when a file mtime moves backwards', async () => {
    const repository = createRepository()
    repository.getIndexedFiles.mockResolvedValue([
      {
        path: 'current.md',
        mtime: 101,
        metadata: {},
        dimension: 2,
      },
    ])
    const manager = createVectorManager(
      createApp({ 'current.md': 'Current' }),
      repository,
    )
    const getEmbedding = jest.fn().mockResolvedValue([0.5, 0.6])

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      { chunkSize: 1000, excludePatterns: [], includePatterns: [] },
    )

    expect(getEmbedding).toHaveBeenCalledTimes(1)
  })

  it('does not replace an index with embeddings from a changed file', async () => {
    const repository = createRepository()
    const app = createApp({ 'current.md': 'Current' })
    const file = app.vault.getMarkdownFiles()[0]
    const manager = createVectorManager(app, repository)
    const getEmbedding = jest
      .fn()
      .mockImplementationOnce(async () => {
        file.stat.mtime += 1
        return [0.5, 0.6]
      })
      .mockResolvedValue([0.5, 0.6])
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding,
    }
    const options = {
      chunkSize: 1000,
      excludePatterns: [] as string[],
      includePatterns: [] as string[],
    }

    await manager.updateVaultIndex(embeddingModel, options)

    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()

    await manager.updateVaultIndex(embeddingModel, options)

    expect(getEmbedding).toHaveBeenCalledTimes(2)
    expect(repository.replaceVectorsForFile).toHaveBeenCalledTimes(1)
  })

  it('removes a stale index without embedding an oversized file', async () => {
    const repository = createRepository()
    const app = createApp({ 'large.md': 'content' })
    app.vault.getMarkdownFiles()[0].stat.size = 16 * 1024 * 1024 + 1
    const manager = createVectorManager(app, repository)
    const getEmbedding = jest.fn()

    await manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      { chunkSize: 1000, excludePatterns: [], includePatterns: [] },
    )

    expect(getEmbedding).not.toHaveBeenCalled()
    expect(repository.replaceVectorsForFile).toHaveBeenCalledWith(
      'large.md',
      expect.objectContaining({ id: 'voyage/voyage-4' }),
      [],
    )
  })

  it('does not repeatedly replace an unchanged skipped file', async () => {
    const repository = createRepository()
    const app = createApp({ 'large.md': 'content' })
    app.vault.getMarkdownFiles()[0].stat.size = 16 * 1024 * 1024 + 1
    const manager = createVectorManager(app, repository)
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn(),
    }

    await manager.updateVaultIndex(embeddingModel, {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
    })
    ;(manager as unknown as { vaultRevision: number }).vaultRevision += 1
    await manager.updateVaultIndex(embeddingModel, {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
    })

    expect(repository.replaceVectorsForFile).toHaveBeenCalledTimes(1)
  })

  it('serializes index replacement before a requested clear', async () => {
    const repository = createRepository()
    let releaseReplacement: (() => void) | undefined
    let markReplacementStarted: (() => void) | undefined
    const replacementStarted = new Promise<void>((resolve) => {
      markReplacementStarted = resolve
    })
    repository.replaceVectorsForFile.mockImplementationOnce(async () => {
      markReplacementStarted?.()
      await new Promise<void>((resolve) => {
        releaseReplacement = resolve
      })
    })
    const manager = createVectorManager(
      createApp({ 'current.md': 'Current' }),
      repository,
    )
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn().mockResolvedValue([0.5, 0.6]),
    }

    const update = manager.updateVaultIndex(embeddingModel, {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
    })
    await replacementStarted
    const clear = manager.clearAllVectors(embeddingModel.id)
    await Promise.resolve()

    expect(repository.clearAllVectors).not.toHaveBeenCalled()
    releaseReplacement?.()
    await Promise.all([update, clear])
    expect(
      repository.replaceVectorsForFile.mock.invocationCallOrder[0],
    ).toBeLessThan(repository.clearAllVectors.mock.invocationCallOrder[0])
  })

  it('closes the mutation queue before accepting more work', async () => {
    const repository = createRepository()
    let releaseEmbedding: (() => void) | undefined
    let markEmbeddingStarted: (() => void) | undefined
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve
    })
    const manager = createVectorManager(
      createApp({ 'current.md': 'Current' }),
      repository,
    )
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn(async () => {
        markEmbeddingStarted?.()
        await new Promise<void>((resolve) => {
          releaseEmbedding = resolve
        })
        return [0.5, 0.6]
      }),
    }

    const update = manager.updateVaultIndex(embeddingModel, {
      chunkSize: 1000,
      excludePatterns: [],
      includePatterns: [],
    })
    await embeddingStarted
    const observedUpdate = update.catch((error: unknown) => error)
    const close = manager.close()

    await expect(manager.clearAllVectors(embeddingModel.id)).rejects.toThrow(
      'Vector manager is closed',
    )
    await expect(observedUpdate).resolves.toMatchObject({ name: 'AbortError' })
    await close
    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    releaseEmbedding?.()
  })

  it('saves a cleared index even when vacuuming fails', async () => {
    const repository = createRepository()
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(createApp({}), repository, save)
    manager.setVacuumCallback(
      jest.fn().mockRejectedValue(new Error('vacuum failed')),
    )
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn(),
    }

    await expect(manager.clearAllVectors(embeddingModel.id)).rejects.toThrow(
      'vacuum failed',
    )
    expect(repository.clearAllVectors).toHaveBeenCalledWith(embeddingModel.id)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('clears multiple retired models with one vacuum and save', async () => {
    const repository = createRepository()
    const save = jest.fn().mockResolvedValue(undefined)
    const vacuum = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(createApp({}), repository, save)
    manager.setVacuumCallback(vacuum)

    await manager.clearAllVectorsForModels(['first-model', 'second-model'])

    expect(repository.clearAllVectorsForModels).toHaveBeenCalledWith([
      'first-model',
      'second-model',
    ])
    expect(vacuum).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('aborts an active embedding request without saving unchanged data', async () => {
    const repository = createRepository()
    const save = jest.fn().mockResolvedValue(undefined)
    const manager = createVectorManager(
      createApp({ 'current.md': 'Current' }),
      repository,
      save,
    )
    const abortController = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const getEmbedding = jest.fn(
      (_text: string, signal?: AbortSignal) =>
        new Promise<number[]>((_resolve, reject) => {
          markStarted?.()
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Operation aborted', 'AbortError')),
            { once: true },
          )
        }),
    )
    const update = manager.updateVaultIndex(
      {
        id: 'voyage/voyage-4',
        providerType: 'voyage',
        model: 'voyage-4',
        dimension: 2,
        getEmbedding,
      },
      {
        chunkSize: 1000,
        excludePatterns: [],
        includePatterns: [],
        signal: abortController.signal,
      },
    )
    const observedUpdate = update.catch((error: unknown) => error)
    await started

    abortController.abort()

    await expect(observedUpdate).resolves.toMatchObject({ name: 'AbortError' })
    expect(getEmbedding).toHaveBeenCalledWith('Current', abortController.signal)
    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('skips an unchanged repeated vault scan and invalidates on Markdown edits', async () => {
    const repository = createRepository()
    const app = createApp({ 'current.md': 'Current' })
    const listeners = new Map<string, (file: { path: string }) => void>()
    const offref = jest.fn()
    Object.assign(app.vault, {
      on: jest.fn(
        (event: string, callback: (file: { path: string }) => void) => {
          listeners.set(event, callback)
          return { event }
        },
      ),
      offref,
    })
    const manager = createVectorManager(app, repository)
    const getMarkdownFiles = jest.spyOn(app.vault, 'getMarkdownFiles')
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn().mockResolvedValue([0.5, 0.6]),
    }
    const options = {
      chunkSize: 1000,
      excludePatterns: [] as string[],
      includePatterns: [] as string[],
    }

    await manager.updateVaultIndex(embeddingModel, options)
    await manager.updateVaultIndex(embeddingModel, options)
    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(1)
    const fullScanCalls = getMarkdownFiles.mock.calls.length

    listeners.get('modify')?.({ path: 'current.md' })
    await manager.updateVaultIndex(embeddingModel, options)
    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(2)
    expect(getMarkdownFiles).toHaveBeenCalledTimes(fullScanCalls)

    listeners.get('rename')?.({ path: 'renamed-folder' })
    await manager.updateVaultIndex(embeddingModel, options)
    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(3)

    listeners.get('delete')?.({ path: 'removed-folder' })
    await manager.updateVaultIndex(embeddingModel, options)
    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(4)

    await manager.close()
    expect(offref).toHaveBeenCalledTimes(4)
  })

  it('caches index snapshots independently for alternating scopes', async () => {
    const repository = createRepository()
    const manager = createVectorManager(
      createApp({ 'a.md': 'A', 'b.md': 'B' }),
      repository,
    )
    const embeddingModel = {
      id: 'voyage/voyage-4',
      providerType: 'voyage' as const,
      model: 'voyage-4',
      dimension: 2,
      getEmbedding: jest.fn().mockResolvedValue([0.5, 0.6]),
    }
    const baseOptions = {
      chunkSize: 1000,
      excludePatterns: [] as string[],
      includePatterns: [] as string[],
    }

    await manager.updateVaultIndex(embeddingModel, {
      ...baseOptions,
      scope: { files: ['a.md'], folders: [] },
    })
    await manager.updateVaultIndex(embeddingModel, {
      ...baseOptions,
      scope: { files: ['b.md'], folders: [] },
    })
    await manager.updateVaultIndex(embeddingModel, {
      ...baseOptions,
      scope: { files: ['a.md'], folders: [] },
    })

    expect(repository.getIndexedFiles).toHaveBeenCalledTimes(2)
  })

  it('does not wait for a scheduled rate-limit retry after abort', async () => {
    jest.useFakeTimers()
    try {
      const repository = createRepository()
      const manager = createVectorManager(
        createApp({ 'current.md': 'Current' }),
        repository,
      )
      const abortController = new AbortController()
      let markWaiting: (() => void) | undefined
      const waiting = new Promise<void>((resolve) => {
        markWaiting = resolve
      })
      const getEmbedding = jest
        .fn()
        .mockRejectedValue(new LLMRateLimitExceededException('rate limited'))
      const update = manager.updateVaultIndex(
        {
          id: 'voyage/voyage-4',
          providerType: 'voyage',
          model: 'voyage-4',
          dimension: 2,
          getEmbedding,
        },
        {
          chunkSize: 1000,
          excludePatterns: [],
          includePatterns: [],
          signal: abortController.signal,
        },
        (progress) => {
          if (progress.waitingForRateLimit) markWaiting?.()
        },
      )
      const observedUpdate = update.catch((error: unknown) => error)
      await waiting

      abortController.abort()

      await expect(observedUpdate).resolves.toMatchObject({
        name: 'AbortError',
      })
      expect(getEmbedding).toHaveBeenCalledTimes(1)
      expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
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
    clearAllVectorsForModels: jest.fn().mockResolvedValue(undefined),
    replaceVectorsForFile: jest.fn(async function (
      this: { insertedVectors: InsertEmbedding[] },
      filePath: string,
      embeddingModel: { id: string },
      vectors: InsertEmbedding[],
    ) {
      this.insertedVectors = this.insertedVectors.filter(
        (vector) =>
          vector.path !== filePath || vector.model !== embeddingModel.id,
      )
      this.insertedVectors.push(...vectors)
    }),
  }
}

function createApp(contents: Record<string, string>): App {
  const files = Object.keys(contents).map((filePath) => createFile(filePath))
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: jest.fn(async (file: TFile) => contents[file.path] ?? ''),
      getAbstractFileByPath: (filePath: string) =>
        files.find((file) => file.path === filePath) ?? null,
    },
  } as unknown as App
}

function createFile(filePath: string): TFile {
  return {
    path: filePath,
    stat: {
      mtime: 100,
    },
  } as TFile
}
