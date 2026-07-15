import { Readable } from 'stream'

import { parseJsonSseStream } from './sse'

describe('parseJsonSseStream', () => {
  it('cancels and unlocks a web stream when the consumer stops early', async () => {
    const cancel = jest.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"value":1}\n\n'))
      },
      cancel,
    })
    const iterator = parseJsonSseStream<{ value: number }>(stream)[
      Symbol.asyncIterator
    ]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { value: 1 },
    })
    await iterator.return?.()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('cancels and unlocks a web stream after malformed JSON', async () => {
    const cancel = jest.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {\n\n'))
      },
      cancel,
    })

    await expect(
      parseJsonSseStream(stream)[Symbol.asyncIterator]().next(),
    ).rejects.toBeInstanceOf(SyntaxError)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('rejects a delimiter-free oversized event', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('x'.repeat(1024 * 1024 + 1)),
        )
      },
    })

    await expect(
      parseJsonSseStream(stream)[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('SSE event is too large')
    expect(stream.locked).toBe(false)
  })

  it('rejects and cancels a stream with too many events', async () => {
    const cancel = jest.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(':\n\n'.repeat(100_001)))
      },
      cancel,
    })

    await expect(
      parseJsonSseStream(stream)[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('SSE stream has too many events')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(stream.locked).toBe(false)
  })

  it('times out and cancels a stalled web stream', async () => {
    jest.useFakeTimers()
    try {
      const cancel = jest.fn()
      const stream = new ReadableStream<Uint8Array>({ cancel })
      const result = expect(
        parseJsonSseStream(stream)[Symbol.asyncIterator]().next(),
      ).rejects.toThrow('SSE stream timed out')

      jest.advanceTimersByTime(10 * 60_000)
      await result
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(stream.locked).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('refreshes the timeout when a web stream keeps producing data', async () => {
    jest.useFakeTimers()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
    })
    const iterator = parseJsonSseStream<{ value: number }>(stream)[
      Symbol.asyncIterator
    ]()

    try {
      const first = iterator.next()
      jest.advanceTimersByTime(9 * 60_000)
      controller?.enqueue(new TextEncoder().encode('data: {"value":1}\n\n'))
      await expect(first).resolves.toEqual({
        done: false,
        value: { value: 1 },
      })

      const second = iterator.next()
      jest.advanceTimersByTime(9 * 60_000)
      controller?.enqueue(new TextEncoder().encode('data: {"value":2}\n\n'))
      await expect(second).resolves.toEqual({
        done: false,
        value: { value: 2 },
      })
    } finally {
      await iterator.return?.()
      jest.useRealTimers()
    }
  })

  it('rejects cumulative oversized content and destroys the node stream', async () => {
    const event = `:${'x'.repeat(1024 * 1024 - 3)}\n\n`
    const stream = Readable.from(Array(65).fill(event))

    await expect(
      parseJsonSseStream(stream)[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('SSE stream is too large')
    expect(stream.destroyed).toBe(true)
  })

  it('decodes UTF-8 split across web stream chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"text":"한"}\n\n')
    const splitIndex = bytes.indexOf(0xed) + 1
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitIndex))
        controller.enqueue(bytes.slice(splitIndex))
        controller.close()
      },
    })

    const values: { text: string }[] = []
    for await (const value of parseJsonSseStream<{ text: string }>(stream)) {
      values.push(value)
    }

    expect(values).toEqual([{ text: '한' }])
    expect(stream.locked).toBe(false)
  })

  it('parses many events delivered in one chunk', async () => {
    const count = 5_000
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            Array.from(
              { length: count },
              (_, index) => `data: {"value":${index}}\n\n`,
            ).join(''),
          ),
        )
        controller.close()
      },
    })

    const values: { value: number }[] = []
    for await (const value of parseJsonSseStream<{ value: number }>(stream)) {
      values.push(value)
    }

    expect(values).toHaveLength(count)
    expect(values[count - 1]).toEqual({ value: count - 1 })
  })
})
