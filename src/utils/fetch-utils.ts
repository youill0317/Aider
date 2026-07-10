import { Platform } from 'obsidian'

const MAX_URL_LENGTH = 2048
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 2
const REQUEST_TIMEOUT_MS = 10_000

let ipPolicy:
  | {
      blockedIpv4: import('net').BlockList
      blockedIpv6: import('net').BlockList
      publicIpv6: import('net').BlockList
    }
  | undefined

type ObsidianRuntimeGlobal = typeof globalThis & {
  readonly require?: {
    (moduleName: 'dns'): typeof import('dns')
    (moduleName: 'http'): typeof import('http')
    (moduleName: 'https'): typeof import('https')
    (moduleName: 'net'): typeof import('net')
  }
}

type PublicUrlResponse = {
  status: number
  headers: Record<string, string>
  text: string
}

type PublicUrlOptions = {
  headers?: Record<string, string>
  maxBytes?: number
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    validatePublicUrl(value)
    return true
  } catch {
    return false
  }
}

export async function fetchPublicUrl(
  value: string,
  options: PublicUrlOptions = {},
): Promise<PublicUrlResponse> {
  if (!Platform.isDesktop) {
    throw new Error('Safe URL fetching is unavailable on mobile')
  }

  let url = validatePublicUrl(value)
  const maxBytes = Math.min(
    Math.max(options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1),
    MAX_RESPONSE_BYTES,
  )

  for (let redirects = 0; ; redirects += 1) {
    const response = await requestPublicUrl(url, options.headers, maxBytes)
    const location = response.headers.location
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`URL request failed with status ${response.status}`)
      }
      return response
    }
    if (redirects >= MAX_REDIRECTS) {
      throw new Error('Too many URL redirects')
    }
    url = validatePublicUrl(new URL(location, url).toString())
  }
}

export async function fetchUrlTitle(url: string): Promise<string | null> {
  try {
    const response = await fetchPublicUrl(url, { maxBytes: 256 * 1024 })
    if (!response.headers['content-type']?.includes('text/html')) {
      return null
    }

    const title = response.text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    const trimmedTitle = title?.trim().slice(0, 512)
    return trimmedTitle?.length ? trimmedTitle : null
  } catch (error) {
    console.warn('Failed to fetch URL title:', error)
    return null
  }
}

function validatePublicUrl(value: string): URL {
  if (value.length > MAX_URL_LENGTH) {
    throw new Error('URL is too long')
  }

  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed')
  }
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed')
  }
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
    throw new Error('Non-standard URL ports are not allowed')
  }

  const hostname = normalizeHostname(url.hostname)
  if (
    !hostname ||
    (!hostname.includes('.') && !isIpAddress(hostname)) ||
    ['localhost', 'local', 'internal', 'lan', 'home', 'localdomain'].some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  ) {
    throw new Error('Local hostnames are not allowed')
  }

  if (isIpAddress(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error('Private or special-purpose IP addresses are not allowed')
  }
  return url
}

async function requestPublicUrl(
  url: URL,
  suppliedHeaders: Record<string, string> | undefined,
  maxBytes: number,
): Promise<PublicUrlResponse> {
  // Pin the validated DNS answer to the socket. Obsidian requestUrl does not
  // expose redirect targets or the connected address, so it cannot prevent
  // DNS rebinding for attacker-controlled URLs.
  const runtimeRequire = getRuntimeRequire()
  const dns = runtimeRequire('dns')
  const http = runtimeRequire('http')
  const https = runtimeRequire('https')
  const hostname = normalizeHostname(url.hostname)
  const addresses = isIpAddress(hostname)
    ? [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }]
    : await dns.promises.lookup(hostname, { all: true, verbatim: true })

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new Error('URL hostname resolves to a private or special address')
  }

  const destination = addresses[0]
  const client = url.protocol === 'https:' ? https : http

  return new Promise((resolve, reject) => {
    let settled = false
    const deadline: { timer?: ReturnType<typeof setTimeout> } = {}
    const clearDeadline = () => {
      if (deadline.timer !== undefined) clearTimeout(deadline.timer)
    }
    const fail = (error: Error) => {
      if (!settled) {
        settled = true
        clearDeadline()
        reject(error)
      }
    }
    const requestOptions: import('https').RequestOptions = {
      protocol: url.protocol,
      hostname: destination.address,
      family: destination.family,
      port: url.protocol === 'https:' ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        ...suppliedHeaders,
        'Accept-Encoding': 'identity',
        Host: url.host,
      },
      ...(url.protocol === 'https:' && !isIpAddress(hostname)
        ? { servername: hostname }
        : {}),
    }
    const request = client.request(requestOptions, (response) => {
      const headers = normalizeHeaders(response.headers)
      const status = response.statusCode ?? 0

      if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
        settled = true
        clearDeadline()
        response.destroy()
        resolve({ status, headers, text: '' })
        return
      }
      if (
        headers['content-encoding'] &&
        headers['content-encoding'] !== 'identity'
      ) {
        response.destroy()
        fail(new Error('Compressed URL responses are not accepted'))
        return
      }

      const contentLength = Number(headers['content-length'])
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy()
        fail(new Error('URL response is too large'))
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > maxBytes) {
          response.destroy()
          fail(new Error('URL response is too large'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        if (!settled) {
          settled = true
          clearDeadline()
          resolve({ status, headers, text: Buffer.concat(chunks).toString() })
        }
      })
      response.on('error', fail)
    })

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('URL request timed out'))
    })
    deadline.timer = setTimeout(() => {
      request.destroy(new Error('URL request deadline exceeded'))
    }, REQUEST_TIMEOUT_MS)
    request.on('error', fail)
    request.end()
  })
}

function normalizeHeaders(
  headers: import('http').IncomingHttpHeaders,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[name.toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : value
    }
  }
  return normalized
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase()
}

function isIpAddress(address: string): boolean {
  if (!Platform.isDesktop) {
    return /^\d+\.\d+\.\d+\.\d+$/.test(address) || address.includes(':')
  }
  return getRuntimeRequire()('net').isIP(address) !== 0
}

function isPublicIpAddress(address: string): boolean {
  if (!Platform.isDesktop) {
    return false
  }

  const net = getRuntimeRequire()('net')
  const family = net.isIP(address)
  if (!family) return false

  if (!ipPolicy) {
    const blockedIpv4 = new net.BlockList()
    ;[
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 3],
    ].forEach(([network, prefix]) =>
      blockedIpv4.addSubnet(network as string, prefix as number, 'ipv4'),
    )
    const blockedIpv6 = new net.BlockList()
    ;[
      ['::', 128],
      ['::1', 128],
      ['::ffff:0:0', 96],
      ['64:ff9b::', 96],
      ['100::', 64],
      ['2001::', 32],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ].forEach(([network, prefix]) =>
      blockedIpv6.addSubnet(network as string, prefix as number, 'ipv6'),
    )
    const publicIpv6 = new net.BlockList()
    publicIpv6.addSubnet('2000::', 3, 'ipv6')
    ipPolicy = { blockedIpv4, blockedIpv6, publicIpv6 }
  }

  return (
    !(family === 4 ? ipPolicy.blockedIpv4 : ipPolicy.blockedIpv6).check(
      address,
      family === 4 ? 'ipv4' : 'ipv6',
    ) &&
    (family === 4 || ipPolicy.publicIpv6.check(address, 'ipv6'))
  )
}

function getRuntimeRequire(): NonNullable<ObsidianRuntimeGlobal['require']> {
  const runtimeRequire = (globalThis as ObsidianRuntimeGlobal).require
  if (!runtimeRequire) {
    throw new Error('Safe URL fetching requires Obsidian desktop Node access')
  }
  return runtimeRequire
}
