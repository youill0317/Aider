import {
  getJson,
  postJson,
  postStream,
  withRequestTimeout,
} from './httpTransport'

describe('HTTP transport resource bounds', () => {
  it('uses the bounded reader for JSON GET requests', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      getJson<{ ok: boolean }>('https://example.com', { fetchFn }),
    ).resolves.toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'GET', signal: expect.anything() }),
    )
  })

  it('bounds requestUrl-style promises that cannot accept an abort signal', async () => {
    jest.useFakeTimers()
    const request = expect(
      withRequestTimeout(new Promise(() => undefined), 10),
    ).rejects.toThrow('Request timed out')
    try {
      await jest.advanceTimersByTimeAsync(10)
      await request
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts cancellable operations when their request timeout expires', async () => {
    jest.useFakeTimers()
    const aborted = jest.fn()
    const request = expect(
      withRequestTimeout(
        (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted()
                reject(signal.reason)
              },
              { once: true },
            )
          }),
        10,
      ),
    ).rejects.toThrow('Request timed out')
    try {
      await jest.advanceTimersByTimeAsync(10)
      await request
      expect(aborted).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects an oversized fetch response before reading it', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined)
    const response = {
      body: { cancel },
      headers: new Headers({
        'content-length': String(8 * 1024 * 1024 + 1),
      }),
      ok: true,
      status: 200,
    } as unknown as Response

    await expect(
      postJson(
        'https://example.com',
        {},
        {
          fetchFn: jest.fn().mockResolvedValue(response),
        },
      ),
    ).rejects.toThrow('too large')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels an unsuccessful streaming fetch response', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined)
    const response = {
      body: { cancel },
      ok: false,
      status: 503,
    } as unknown as Response

    await expect(
      postStream(
        'https://example.com',
        {},
        {
          fetchFn: jest.fn().mockResolvedValue(response),
        },
      ),
    ).rejects.toThrow('503')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('applies a response-header timeout when no signal is supplied', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    ) as typeof fetch

    const request = expect(
      postJson('https://example.com', {}, { fetchFn }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await jest.advanceTimersByTimeAsync(60_000)
      await request
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the response timeout when a caller signal is supplied', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          )
        }),
    ) as typeof fetch
    const caller = new AbortController()

    const request = expect(
      postJson(
        'https://example.com',
        {},
        {
          fetchFn,
          signal: caller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await jest.advanceTimersByTimeAsync(60_000)
      await request
    } finally {
      jest.useRealTimers()
    }
  })

  it('applies the timeout while reading a non-streaming response body', async () => {
    jest.useFakeTimers()
    const response = new Response(
      new ReadableStream<Uint8Array>({ start: () => undefined }),
      { status: 200 },
    )

    const request = expect(
      postJson(
        'https://example.com',
        {},
        {
          fetchFn: jest.fn().mockResolvedValue(response),
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await jest.advanceTimersByTimeAsync(60_000)
      await request
    } finally {
      jest.useRealTimers()
    }
  })

  it('times out a stalled streaming body and releases caller listeners', async () => {
    jest.useFakeTimers()
    const caller = new AbortController()
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener')
    const response = new Response(
      new ReadableStream<Uint8Array>({ start: () => undefined }),
      { status: 200 },
    )
    const stream = await postStream(
      'https://example.com',
      {},
      {
        fetchFn: jest.fn().mockResolvedValue(response),
        signal: caller.signal,
      },
    )
    const read = expect(
      (stream as ReadableStream<Uint8Array>).getReader().read(),
    ).rejects.toMatchObject({ name: 'AbortError' })

    try {
      await jest.advanceTimersByTimeAsync(60_000)
      await read
      expect(removeListener).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
