import { EmbeddingModelClient } from '../../../types/embedding'
import { IndexProgress } from '../../chat-view/QueryProgress'

import { rebuildEmbeddingIndex } from './rebuild-embedding-index'

const RAG_OPTIONS = {
  chunkSize: 1000,
  excludePatterns: [],
  includePatterns: [],
}

type UpdateCall = {
  onProgress?: (progress: IndexProgress) => void
  reject: (error: unknown) => void
  resolve: () => void
  signal: AbortSignal
}

/**
 * Harness that leaves every updateVaultIndex call hanging until the test
 * settles it, so concurrency and abort behavior are observable.
 */
function createHarness() {
  const calls: UpdateCall[] = []
  const errors: unknown[] = []
  const progress: [string, IndexProgress | null][] = []
  const controllers = new Map<string, AbortController>()
  let mounted = true
  let refetchCount = 0

  const updateVaultIndex = jest.fn(
    (
      _model: EmbeddingModelClient,
      options: { signal: AbortSignal },
      onProgress?: (p: IndexProgress) => void,
    ) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ onProgress, reject, resolve, signal: options.signal })
      }),
  )

  const rebuild = (
    modelId: string,
    overrides: { getEmbeddingModel?: () => EmbeddingModelClient } = {},
  ) =>
    rebuildEmbeddingIndex({
      controllers,
      getEmbeddingModel: () => ({}) as EmbeddingModelClient,
      getVectorManager: () => Promise.resolve({ updateVaultIndex }),
      isMounted: () => mounted,
      modelId,
      onError: (error) => errors.push(error),
      ragOptions: RAG_OPTIONS,
      refetch: async () => {
        refetchCount += 1
      },
      setProgress: (id, next) => progress.push([id, next]),
      ...overrides,
    })

  return {
    calls,
    controllers,
    errors,
    progress,
    rebuild,
    refetchCount: () => refetchCount,
    unmount: () => {
      mounted = false
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
    },
    updateVaultIndex,
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('rebuildEmbeddingIndex', () => {
  it('ignores a second rebuild of the same model while one is in flight', async () => {
    const harness = createHarness()

    const first = harness.rebuild('model-a')
    await flush()
    const second = harness.rebuild('model-a')
    await flush()

    expect(harness.updateVaultIndex).toHaveBeenCalledTimes(1)
    harness.calls.forEach((call) => call.resolve())
    await Promise.all([first, second])
  })

  it('allows a rebuild of the same model once the previous one settles', async () => {
    const harness = createHarness()

    const first = harness.rebuild('model-a')
    await flush()
    harness.calls[0].resolve()
    await first

    expect(harness.controllers.size).toBe(0)
    const second = harness.rebuild('model-a')
    await flush()
    expect(harness.updateVaultIndex).toHaveBeenCalledTimes(2)
    harness.calls[1].resolve()
    await second
  })

  it('rebuilds different models concurrently', async () => {
    const harness = createHarness()

    const both = Promise.all([
      harness.rebuild('model-a'),
      harness.rebuild('model-b'),
    ])
    await flush()

    expect(harness.updateVaultIndex).toHaveBeenCalledTimes(2)
    harness.calls.forEach((call) => call.resolve())
    await both
  })

  it('aborts the in-flight rebuild when the modal unmounts', async () => {
    const harness = createHarness()

    const pending = harness.rebuild('model-a')
    await flush()
    expect(harness.calls[0].signal.aborted).toBe(false)

    harness.unmount()

    expect(harness.calls[0].signal.aborted).toBe(true)
    harness.calls[0].reject(new DOMException('aborted', 'AbortError'))
    await pending

    // The unmount caused this failure, so it is not reported to the user and
    // nothing touches component state afterwards.
    expect(harness.errors).toEqual([])
    expect(harness.progress).toEqual([
      ['model-a', { completedChunks: 0, totalChunks: 1, totalFiles: 0 }],
    ])
    expect(harness.refetchCount()).toBe(0)
  })

  it('drops progress updates that arrive after an abort', async () => {
    const harness = createHarness()

    const pending = harness.rebuild('model-a')
    await flush()
    harness.calls[0].onProgress?.({
      completedChunks: 1,
      totalChunks: 4,
      totalFiles: 2,
    })
    harness.unmount()
    harness.calls[0].onProgress?.({
      completedChunks: 3,
      totalChunks: 4,
      totalFiles: 2,
    })
    harness.calls[0].reject(new DOMException('aborted', 'AbortError'))
    await pending

    expect(harness.progress).toEqual([
      ['model-a', { completedChunks: 0, totalChunks: 1, totalFiles: 0 }],
      ['model-a', { completedChunks: 1, totalChunks: 4, totalFiles: 2 }],
    ])
  })

  it('reports a real failure and still clears progress', async () => {
    const harness = createHarness()

    const pending = harness.rebuild('model-a')
    await flush()
    harness.calls[0].reject(new Error('embedding provider is down'))
    await pending

    expect(harness.errors).toEqual([new Error('embedding provider is down')])
    expect(harness.progress[harness.progress.length - 1]).toEqual([
      'model-a',
      null,
    ])
    expect(harness.refetchCount()).toBe(1)
    expect(harness.controllers.size).toBe(0)
  })

  it('reports a model that cannot be resolved without leaving the guard set', async () => {
    const harness = createHarness()

    await harness.rebuild('model-a', {
      getEmbeddingModel: () => {
        throw new Error('embedding model model-a not found')
      },
    })

    expect(harness.updateVaultIndex).not.toHaveBeenCalled()
    expect(harness.errors).toEqual([
      new Error('embedding model model-a not found'),
    ])
    expect(harness.controllers.size).toBe(0)
  })
})
