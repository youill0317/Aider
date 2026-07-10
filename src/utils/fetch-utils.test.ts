import * as dns from 'dns'
import { EventEmitter } from 'events'
import { IncomingMessage } from 'http'
import * as http from 'http'
import * as https from 'https'
import { PassThrough } from 'stream'

import { App } from 'obsidian'

import { fetchAnnotationTitles } from './chat/fetch-annotation-titles'
import { deserializeMentionable } from './chat/mentionable'
import { fetchPublicUrl, isPublicHttpUrl } from './fetch-utils'

jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }))
jest.mock('http', () => ({ request: jest.fn() }))
jest.mock('https', () => ({ request: jest.fn() }))
;(globalThis as typeof globalThis & { require?: NodeRequire }).require = require

const mockLookup = dns.promises.lookup as jest.Mock
const mockHttpRequest = http.request as jest.Mock
const mockHttpsRequest = https.request as jest.Mock

describe('public URL fetch boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it.each([
    'file:///etc/passwd',
    'http://user:secret@example.com',
    'http://localhost',
    'http://metadata.google.internal/latest/meta-data',
    'http://127.0.0.1',
    'http://2130706433',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'https://example.com:8443',
  ])('rejects unsafe URL %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it('accepts normal public HTTP(S) URLs', () => {
    expect(isPublicHttpUrl('https://example.com/path?q=1')).toBe(true)
    expect(isPublicHttpUrl('http://93.184.216.34')).toBe(true)
    expect(isPublicHttpUrl('https://[2606:4700:4700::1111]')).toBe(true)
  })

  it('rejects a hostname if any pinned DNS answer is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    await expect(fetchPublicUrl('https://rebinding.example')).rejects.toThrow(
      'private or special address',
    )
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('validates a redirect before making the next request', async () => {
    mockHttpsRequest.mockImplementation(
      fakeRequest(302, { location: 'http://127.0.0.1/admin' }),
    )

    await expect(fetchPublicUrl('https://public.example')).rejects.toThrow(
      'Private or special-purpose',
    )
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1)
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('stops reading responses at the byte limit', async () => {
    mockHttpsRequest.mockImplementation(fakeRequest(200, {}, '12345'))

    await expect(
      fetchPublicUrl('https://public.example', { maxBytes: 4 }),
    ).rejects.toThrow('too large')
  })

  it('enforces a wall-clock request deadline', async () => {
    jest.useFakeTimers()
    try {
      mockHttpsRequest.mockImplementation(() => new FakeRequest())
      const request = fetchPublicUrl('https://public.example')
      const observed = request.catch((error: unknown) => error)

      await jest.advanceTimersByTimeAsync(10_000)

      await expect(observed).resolves.toEqual(
        expect.objectContaining({ message: 'URL request deadline exceeded' }),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('caps automatic citation title requests per batch', async () => {
    mockHttpsRequest.mockImplementation(
      fakeRequest(
        200,
        { 'content-type': 'text/html' },
        '<title>Public page</title>',
      ),
    )
    const onTitle = jest.fn()

    fetchAnnotationTitles(
      Array.from({ length: 6 }, (_, index) => ({
        type: 'url_citation' as const,
        url_citation: { url: `https://public-${index}.example` },
      })),
      onTitle,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(mockHttpsRequest).toHaveBeenCalledTimes(5)
    expect(onTitle).toHaveBeenCalledTimes(5)
  })

  it('drops unsafe URL mentions restored from stored chat data', () => {
    expect(
      deserializeMentionable(
        { type: 'url', url: 'http://169.254.169.254/latest/meta-data' },
        {} as App,
      ),
    ).toBeNull()
  })

  it('does not fetch titles for unsafe provider citations', () => {
    const onTitle = jest.fn()
    fetchAnnotationTitles(
      [
        {
          type: 'url_citation',
          url_citation: { url: 'http://127.0.0.1/admin' },
        },
      ],
      onTitle,
    )
    expect(onTitle).not.toHaveBeenCalled()
  })
})

function fakeRequest(
  statusCode: number,
  headers: Record<string, string>,
  body = '',
) {
  return (_options: unknown, callback: (response: IncomingMessage) => void) => {
    const request = new FakeRequest()
    const response = Object.assign(new PassThrough(), {
      statusCode,
      headers,
    })
    queueMicrotask(() => {
      callback(response as unknown as IncomingMessage)
      queueMicrotask(() => response.end(body))
    })
    return request
  }
}

class FakeRequest extends EventEmitter {
  setTimeout() {
    return this
  }

  destroy(error?: Error) {
    if (error) this.emit('error', error)
    return this
  }

  end() {
    return this
  }
}
