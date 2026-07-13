import type { StreamSource } from './httpTransport'

type SseBoundary = {
  index: number
  length: number
}

const MAX_SSE_BUFFER_CHARS = 1024 * 1024
const MAX_SSE_STREAM_CHARS = 64 * 1024 * 1024
const MAX_SSE_EVENTS = 100_000
const MAX_SSE_DURATION_MS = 10 * 60_000

export async function* parseJsonSseStream<T>(
  body: StreamSource,
): AsyncIterable<T> {
  const decoder = new TextDecoder()
  let buffer = ''
  let totalChars = 0
  let totalEvents = 0
  let durationTimeout: ReturnType<typeof setTimeout> | undefined
  const durationExceeded = new Promise<never>((_resolve, reject) => {
    durationTimeout = setTimeout(
      () => reject(new Error('SSE stream timed out')),
      MAX_SSE_DURATION_MS,
    )
  })
  const appendChunk = (chunk: string) => {
    totalChars += chunk.length
    if (totalChars > MAX_SSE_STREAM_CHARS) {
      throw new Error('SSE stream is too large')
    }
    buffer += chunk
    assertBufferWithinLimit(buffer)
  }
  const countEvent = () => {
    totalEvents += 1
    if (totalEvents > MAX_SSE_EVENTS) {
      throw new Error('SSE stream has too many events')
    }
  }

  try {
    if (isWebReadableStream(body)) {
      const reader = body.getReader()
      let completed = false
      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            durationExceeded,
          ])
          if (value) {
            appendChunk(decoder.decode(value, { stream: true }))
          }
          if (done) {
            appendChunk(decoder.decode())
            break
          }
          yield* flushSseBuffer(
            buffer,
            (next) => {
              buffer = next
            },
            countEvent,
          )
        }
        yield* flushSseBuffer(
          buffer,
          (next) => {
            buffer = next
          },
          countEvent,
          true,
        )
        completed = true
      } finally {
        if (!completed) {
          await reader.cancel().catch(() => undefined)
        }
        reader.releaseLock()
      }
      return
    }

    const nodeBody = body as NodeJS.ReadableStream & { destroy?: () => void }
    const iterator = nodeBody[Symbol.asyncIterator]()
    let completed = false
    try {
      while (true) {
        const { value: chunk, done } = await Promise.race([
          iterator.next(),
          durationExceeded,
        ])
        if (done) break
        appendChunk(
          typeof chunk === 'string'
            ? chunk
            : decoder.decode(chunk as Uint8Array, { stream: true }),
        )
        yield* flushSseBuffer(
          buffer,
          (next) => {
            buffer = next
          },
          countEvent,
        )
      }
      appendChunk(decoder.decode())
      yield* flushSseBuffer(
        buffer,
        (next) => {
          buffer = next
        },
        countEvent,
        true,
      )
      completed = true
    } finally {
      if (!completed) {
        nodeBody.destroy?.()
        await Promise.resolve(iterator.return?.()).catch(() => undefined)
      }
    }
  } finally {
    if (durationTimeout) clearTimeout(durationTimeout)
  }
}

function assertBufferWithinLimit(buffer: string): void {
  if (buffer.length > MAX_SSE_BUFFER_CHARS) {
    throw new Error('SSE event is too large')
  }
}

function isWebReadableStream(
  body: StreamSource,
): body is ReadableStream<Uint8Array> {
  return typeof (body as ReadableStream<Uint8Array>).getReader === 'function'
}

function findSseBoundary(buffer: string, fromIndex = 0): SseBoundary | null {
  const candidates: SseBoundary[] = []
  const lfIndex = buffer.indexOf('\n\n', fromIndex)
  if (lfIndex !== -1) {
    candidates.push({ index: lfIndex, length: 2 })
  }
  const crIndex = buffer.indexOf('\r\r', fromIndex)
  if (crIndex !== -1) {
    candidates.push({ index: crIndex, length: 2 })
  }
  const crlfIndex = buffer.indexOf('\r\n\r\n', fromIndex)
  if (crlfIndex !== -1) {
    candidates.push({ index: crlfIndex, length: 4 })
  }
  if (candidates.length === 0) {
    return null
  }
  return candidates.reduce((earliest, candidate) =>
    candidate.index < earliest.index ? candidate : earliest,
  )
}

function* flushSseBuffer<T>(
  buffer: string,
  updateBuffer: (next: string) => void,
  countEvent: () => void,
  flushPartial = false,
): Iterable<T> {
  let offset = 0
  let boundary = findSseBoundary(buffer, offset)
  while (boundary) {
    const rawEvent = buffer.slice(offset, boundary.index)
    offset = boundary.index + boundary.length
    countEvent()
    yield* parseSseEvent<T>(rawEvent)
    boundary = findSseBoundary(buffer, offset)
  }
  if (flushPartial && offset < buffer.length) {
    countEvent()
    yield* parseSseEvent<T>(buffer.slice(offset))
    offset = buffer.length
  }
  updateBuffer(buffer.slice(offset))
}

function* parseSseEvent<T>(rawEvent: string): Iterable<T> {
  const dataLines = rawEvent
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith('data:'))
  if (dataLines.length === 0) {
    return
  }
  const data = dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n')
  if (data && !data.startsWith('[DONE]')) {
    yield JSON.parse(data) as T
  }
}
