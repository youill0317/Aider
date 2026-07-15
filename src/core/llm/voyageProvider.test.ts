import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'
import { VoyageProvider } from './voyageProvider'

describe('VoyageProvider', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('requests embeddings from the Voyage API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200 },
      ),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })
    const controller = new AbortController()

    const embedding = await provider.getEmbedding('voyage-4', 'hello', {
      dimensions: 512,
      signal: controller.signal,
    })

    expect(embedding).toEqual([0.1, 0.2, 0.3])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer voyage-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'hello',
          model: 'voyage-4',
          output_dimension: 512,
        }),
        signal: expect.any(AbortSignal),
      },
    )
  })

  it('requests contextual document embeddings with Voyage server auto chunking defaults', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              data: [
                { embedding: [0.1, 0.2], text: 'First returned chunk' },
                { embedding: [0.3, 0.4], text: 'Second returned chunk' },
              ],
            },
          ],
          chunker_version: 'ctx-v1',
        }),
        { status: 200 },
      ),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })
    const controller = new AbortController()

    const result = await provider.getContextualEmbeddings(
      'voyage-context-4',
      'Full markdown document',
      { inputType: 'document', signal: controller.signal },
    )

    expect(result).toEqual({
      chunks: [
        { embedding: [0.1, 0.2], text: 'First returned chunk' },
        { embedding: [0.3, 0.4], text: 'Second returned chunk' },
      ],
      chunkerVersion: 'ctx-v1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/contextualizedembeddings',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer voyage-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: ['Full markdown document'],
          model: 'voyage-context-4',
          input_type: 'document',
          enable_auto_chunking: true,
        }),
        signal: expect.any(AbortSignal),
      },
    )
    const requestInit = fetchMock.mock.calls[0]?.[1]
    if (!requestInit || typeof requestInit.body !== 'string') {
      throw new Error('Expected Voyage contextual request body.')
    }
    const body = JSON.parse(requestInit.body) as Record<string, unknown>
    expect(body).not.toHaveProperty('chunk_size')
    expect(body).not.toHaveProperty('chunk_overlap')
  })

  it('requests contextual query embeddings without document auto chunking', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              data: [{ embedding: [0.9, 0.8], text: 'search query' }],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    const result = await provider.getContextualEmbeddings(
      'voyage-context-4',
      'search query',
      { inputType: 'query' },
    )

    expect(result.chunks[0]?.embedding).toEqual([0.9, 0.8])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/contextualizedembeddings',
      expect.objectContaining({
        body: JSON.stringify({
          inputs: ['search query'],
          model: 'voyage-context-4',
          input_type: 'query',
        }),
      }),
    )
  })

  it('rejects contextual document chunks without returned text', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ data: [{ embedding: [0.1, 0.2] }] }],
        }),
        { status: 200 },
      ),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(
      provider.getContextualEmbeddings('voyage-context-4', 'document', {
        inputType: 'document',
      }),
    ).rejects.toThrow(
      'Voyage AI contextual document response did not include chunk text.',
    )
  })

  it('requires an API key before requesting embeddings', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMAPIKeyNotSetException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps Voyage authentication failures to API key errors', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'bad-key',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMAPIKeyInvalidException)
  })

  it('maps Voyage rate limit failures to rate limit errors', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429 }))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMRateLimitExceededException)
  })

  it('preserves caller cancellation', async () => {
    let requestSignal: AbortSignal | undefined
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requestSignal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => {
            if (requestSignal?.aborted) {
              reject(requestSignal.reason)
              return
            }
            requestSignal?.addEventListener(
              'abort',
              () => reject(requestSignal?.reason),
              { once: true },
            )
          })
        },
      )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })
    const controller = new AbortController()
    const reason = new Error('caller cancelled')

    const request = provider.getEmbedding('voyage-4', 'hello', {
      signal: controller.signal,
    })
    controller.abort(reason)

    await expect(request).rejects.toBe(reason)
    expect(requestSignal?.aborted).toBe(true)
  })

  it('aborts contextual embedding requests after 60 seconds', async () => {
    jest.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requestSignal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => {
            requestSignal?.addEventListener(
              'abort',
              () => reject(requestSignal?.reason),
              { once: true },
            )
          })
        },
      )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    const rejection = expect(
      provider.getContextualEmbeddings('voyage-context-4', 'document', {
        inputType: 'document',
      }),
    ).rejects.toThrow('Voyage AI request timed out.')
    await jest.advanceTimersByTimeAsync(60_000)

    await rejection
    expect(requestSignal?.aborted).toBe(true)
  })

  it('rejects responses with a declared size over 8 MiB', async () => {
    const cancel = jest.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-length': String(8 * 1024 * 1024 + 1) },
      }),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(provider.getEmbedding('voyage-4', 'hello')).rejects.toThrow(
      'Voyage AI response exceeded the 8 MiB size limit.',
    )
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('stops reading streamed responses that exceed 8 MiB', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1))
        controller.close()
      },
    })
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(body, { status: 200 }))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(provider.getEmbedding('voyage-4', 'hello')).rejects.toThrow(
      'Voyage AI response exceeded the 8 MiB size limit.',
    )
  })
})
