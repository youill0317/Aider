import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'
import { VoyageProvider } from './voyageProvider'

describe('VoyageProvider', () => {
  afterEach(() => {
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

    const embedding = await provider.getEmbedding('voyage-4', 'hello', {
      dimensions: 512,
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
      },
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
})
