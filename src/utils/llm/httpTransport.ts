/*
 * Codex endpoints block direct fetch with CORS, so we use Node's http/https on
 * desktop. Obsidian's requestUrl can bypass CORS but does not support streaming
 * today; Codex requires stream: true, so a non-streaming fallback needs more
 * work and is not worth it for now. Mobile has no Node APIs, so Node modules are
 * loaded at runtime only when running on desktop.
 */
import type { IncomingMessage } from 'http'

import { Platform } from 'obsidian'

export type StreamSource = ReadableStream<Uint8Array> | NodeJS.ReadableStream

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

type PostOptions = {
  headers?: Record<string, string>
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

export async function getJson<T>(
  endpoint: string,
  options: PostOptions = {},
): Promise<T> {
  const { headers, signal, fetchFn = fetch } = options
  const timedFetch = await fetchWithTimeout(fetchFn, endpoint, {
    method: 'GET',
    headers,
    signal,
  })
  try {
    if (!timedFetch.response.ok) {
      await timedFetch.response.body?.cancel()
      throw new Error(`Request failed: ${timedFetch.response.status}`)
    }
    return JSON.parse(
      await readFetchBody(timedFetch.response, timedFetch.signal),
    ) as T
  } finally {
    timedFetch.cleanup()
  }
}

export async function withRequestTimeout<T>(
  operation: Promise<T>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Request timed out')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function postJson<T>(
  endpoint: string,
  body: unknown,
  options: PostOptions = {},
): Promise<T> {
  const { headers, signal, fetchFn } = options
  const payload = JSON.stringify(body)

  if (fetchFn) {
    const timedFetch = await fetchWithTimeout(fetchFn, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: payload,
      signal,
    })
    try {
      if (!timedFetch.response.ok) {
        await timedFetch.response.body?.cancel()
        throw new Error(`Request failed: ${timedFetch.response.status}`)
      }

      return JSON.parse(
        await readFetchBody(timedFetch.response, timedFetch.signal),
      ) as T
    } finally {
      timedFetch.cleanup()
    }
  }

  const response = await nodePost(endpoint, payload, headers, signal)
  const status = response.statusCode ?? 0
  const responseBody = await readStreamToString(response)
  if (status < 200 || status >= 300) {
    throw new Error(`Request failed: ${status} ${responseBody}`)
  }

  return JSON.parse(responseBody) as T
}

export async function postFormUrlEncoded<T>(
  endpoint: string,
  body: Record<string, string>,
  options: PostOptions = {},
): Promise<T> {
  const { headers, signal, fetchFn } = options
  const payload = new URLSearchParams(body).toString()
  const formHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(headers ?? {}),
  }

  if (fetchFn) {
    const timedFetch = await fetchWithTimeout(fetchFn, endpoint, {
      method: 'POST',
      headers: formHeaders,
      body: payload,
      signal,
    })
    try {
      if (!timedFetch.response.ok) {
        await timedFetch.response.body?.cancel()
        throw new Error(`Request failed: ${timedFetch.response.status}`)
      }

      return JSON.parse(
        await readFetchBody(timedFetch.response, timedFetch.signal),
      ) as T
    } finally {
      timedFetch.cleanup()
    }
  }

  const response = await nodePost(
    endpoint,
    payload,
    formHeaders,
    signal,
    'application/x-www-form-urlencoded',
  )
  const status = response.statusCode ?? 0
  const responseBody = await readStreamToString(response)
  if (status < 200 || status >= 300) {
    throw new Error(`Request failed: ${status} ${responseBody}`)
  }

  return JSON.parse(responseBody) as T
}

export async function postStream(
  endpoint: string,
  body: unknown,
  options: PostOptions = {},
): Promise<StreamSource> {
  const { headers, signal, fetchFn } = options
  const payload = JSON.stringify(body)

  if (fetchFn) {
    const timedFetch = await fetchWithTimeout(fetchFn, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      body: payload,
      signal,
    })

    if (!timedFetch.response.ok || !timedFetch.response.body) {
      await timedFetch.response.body?.cancel()
      timedFetch.cleanup()
      throw new Error(`Request failed: ${timedFetch.response.status}`)
    }

    return wrapTimedStream(timedFetch.response.body, timedFetch)
  }

  const response = await nodePost(endpoint, payload, headers, signal)
  const status = response.statusCode ?? 0
  if (status < 200 || status >= 300) {
    const responseBody = await readStreamToString(response)
    throw new Error(`Request failed: ${status} ${responseBody}`)
  }

  return response
}

async function nodePost(
  endpoint: string,
  body: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  contentType = 'application/json',
): Promise<IncomingMessage> {
  if (!Platform.isDesktop) {
    throw new Error('HTTP transport is not available on mobile')
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require('https') as typeof import('https')
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('HTTP transport only supports HTTP(S) endpoints')
  }
  const client = url.protocol === 'https:' ? https : http
  const payloadLength = Buffer.byteLength(body)
  const requestHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': payloadLength.toString(),
    ...(headers ?? {}),
  }

  return new Promise((resolve, reject) => {
    let responseReceived = false
    let abortHandler: (() => void) | undefined
    const removeAbortHandler = () => {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler)
      }
    }
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: requestHeaders,
      },
      (response) => {
        responseReceived = true
        settled = true
        response.once('close', removeAbortHandler)
        resolve(response)
      },
    )

    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      removeAbortHandler()
      reject(error)
    }

    request.on('error', (error) => {
      rejectOnce(error)
    })

    if (signal) {
      const abortError = new Error('Request aborted')
      abortError.name = 'AbortError'
      if (signal.aborted) {
        rejectOnce(abortError)
        request.destroy(abortError)
        return
      }
      abortHandler = () => {
        rejectOnce(abortError)
        request.destroy(abortError)
      }
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out'))
    })
    request.once('close', () => {
      if (!responseReceived) removeAbortHandler()
    })

    request.write(body)
    request.end()
  })
}

async function readStreamToString(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    const bytes =
      typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Uint8Array)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      const error = new Error('Response body is too large')
      ;(
        stream as NodeJS.ReadableStream & { destroy?: (error: Error) => void }
      ).destroy?.(error)
      throw error
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readFetchBody(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('Response body is too large')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let totalBytes = 0
  let completed = false
  try {
    while (!completed) {
      const { done, value } = signal
        ? await raceWithAbort(reader.read(), signal)
        : await reader.read()
      if (done) {
        completed = true
        body += decoder.decode()
        continue
      }
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new Error('Response body is too large')
      }
      body += decoder.decode(value, { stream: true })
    }
    return body
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function wrapTimedStream(
  source: ReadableStream<Uint8Array>,
  timedFetch: Awaited<ReturnType<typeof fetchWithTimeout>>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let finished = false
  const finish = async (cancel: boolean) => {
    if (finished) return
    finished = true
    timedFetch.cleanup()
    if (cancel) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      timedFetch.refreshTimeout()
      try {
        const { done, value } = await raceWithAbort(
          reader.read(),
          timedFetch.signal,
        )
        if (done) {
          await finish(false)
          controller.close()
          return
        }
        controller.enqueue(value)
        timedFetch.refreshTimeout()
      } catch (error) {
        await finish(true)
        controller.error(error)
      }
    },
    async cancel(reason) {
      if (finished) return
      finished = true
      timedFetch.cleanup()
      await reader.cancel(reason).catch(() => undefined)
      reader.releaseLock()
    },
  })
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted()
  let abortHandler: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () =>
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
    signal.addEventListener('abort', abortHandler, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  endpoint: string,
  init: RequestInit,
): Promise<{
  response: Response
  signal: AbortSignal
  cleanup: () => void
  refreshTimeout: () => void
}> {
  const controller = new AbortController()
  const externalSignal = init.signal ?? undefined
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromCaller()
  else
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  let timeout: ReturnType<typeof setTimeout>
  const refreshTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(
      () =>
        controller.abort(new DOMException('Request timed out', 'AbortError')),
      REQUEST_TIMEOUT_MS,
    )
  }
  refreshTimeout()
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
  try {
    const response = await fetchFn(endpoint, {
      ...init,
      signal: controller.signal,
    })
    return {
      response,
      signal: controller.signal,
      cleanup,
      refreshTimeout,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}
