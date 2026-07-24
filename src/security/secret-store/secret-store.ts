type SecretBackendStatus = 'obsidian-secret-storage' | 'memory-only-fallback'

export type SecretStore = {
  readonly getSecret: (key: string) => Promise<string | null>
  readonly setSecret: (key: string, value: string) => Promise<void>
  readonly deleteSecret: (key: string) => Promise<void>
  readonly getBackendStatus: () => SecretBackendStatus
}

type ObsidianSecretStorageLike = {
  readonly getSecret: (key: string) => Promise<string | null>
  readonly setSecret: (key: string, value: string) => Promise<void>
  readonly deleteSecret?: (key: string) => Promise<void>
}

type UnknownFunction = (...args: readonly unknown[]) => unknown

type CreateSecretStoreOptions = {
  readonly app?: unknown
}

type SecretStoreKeyParts = {
  readonly providerId: string
  readonly providerType: string
  readonly field: string
}

type SecretStoreKeyNamespace = 'aider' | 'smart-composer'
type SecretStoreIdentifier =
  | 'provider-id-encoded'
  | 'provider-id-legacy-encoded'
  | 'provider-id-plain'

const LEGACY_CHUNKED_SECRET_PREFIX = '__aider_secret_chunked_v1__:'
const CHUNKED_SECRET_PREFIX = '__aider_secret_chunked_v2__:'
const SECRET_CHUNK_SIZE = 1000
const MAX_SECRET_CHUNKS = 10_000
const MAX_SECRET_LENGTH = SECRET_CHUNK_SIZE * MAX_SECRET_CHUNKS
const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g
const KEY_PART_SEPARATOR_PATTERN = /[\s_-]/
const NON_ALNUM_KEY_PART_PATTERN = /[^a-z0-9]+/g
const EDGE_DASHES_PATTERN = /^-+|-+$/g

type ChunkedSecretMetadata = {
  readonly count: number
  readonly generation?: string
}

function normalizeSecretStoreKeyPart(value: string): string {
  const normalizedValue = KEY_PART_SEPARATOR_PATTERN.test(value)
    ? value
    : value.replace(CAMEL_CASE_BOUNDARY_PATTERN, '$1-$2')

  return normalizedValue
    .toLowerCase()
    .replace(NON_ALNUM_KEY_PART_PATTERN, '-')
    .replace(EDGE_DASHES_PATTERN, '')
}

function encodeProviderId(value: string): string {
  const fnvPrime32 = 0x01000193
  const fnvOffset32 = 0x811c9dc5
  let highHash = fnvOffset32
  let lowHash = fnvOffset32

  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)
    highHash ^= charCode
    highHash = Math.imul(highHash, fnvPrime32) >>> 0
    lowHash ^= (charCode << 7) | (charCode >>> 16)
    lowHash = Math.imul(lowHash, fnvPrime32) >>> 0
  }

  return `id-${highHash.toString(16).padStart(8, '0')}${lowHash
    .toString(16)
    .padStart(8, '0')}`
}

function encodeLegacyProviderId(value: string): string {
  const encodedCodeUnits: string[] = []

  for (let index = 0; index < value.length; index += 1) {
    encodedCodeUnits.push(value.charCodeAt(index).toString(16).padStart(4, '0'))
  }

  return `id-${encodedCodeUnits.join('-')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isFunction(value: unknown): value is UnknownFunction {
  return typeof value === 'function'
}

function getObsidianSecretStorage(
  app: unknown,
): ObsidianSecretStorageLike | undefined {
  if (!isRecord(app) || !isRecord(app.secretStorage)) {
    return undefined
  }

  const secretStorage = app.secretStorage
  const { deleteSecret, getSecret, setSecret } = secretStorage

  if (!isFunction(getSecret) || !isFunction(setSecret)) {
    return undefined
  }

  if (deleteSecret !== undefined && !isFunction(deleteSecret)) {
    return undefined
  }

  return {
    getSecret: async (key) => {
      const value = await getSecret.call(secretStorage, key)
      return typeof value === 'string' ? value : null
    },
    setSecret: async (key, value) => {
      await setSecret.call(secretStorage, key, value)
    },
    deleteSecret:
      deleteSecret === undefined
        ? undefined
        : async (key) => {
            await deleteSecret.call(secretStorage, key)
          },
  }
}

function createFallbackSecretStore(): SecretStore {
  const values = new Map<string, string>()

  return {
    getBackendStatus: () => 'memory-only-fallback',
    getSecret: async (key) => {
      const value = values.get(key)
      return value === undefined || value === '' ? null : value
    },
    setSecret: async (key, value) => {
      values.set(key, value)
    },
    deleteSecret: async (key) => {
      values.delete(key)
    },
  }
}

function createObsidianSecretStore(
  secretStorage: ObsidianSecretStorageLike,
): SecretStore {
  const deleteStoredSecret = async (key: string) => {
    if (secretStorage.deleteSecret) {
      await secretStorage.deleteSecret(key)
      return
    }

    await secretStorage.setSecret(key, '')
  }

  const cleanupChunks = async (
    key: string,
    startIndex: number,
    metadata: ChunkedSecretMetadata,
  ) => {
    let firstError: unknown
    let failed = false
    for (let index = startIndex; index < metadata.count; index += 1) {
      try {
        await deleteStoredSecret(
          createChunkKey(key, index, metadata.generation),
        )
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }
    if (failed) {
      throw firstError
    }
  }

  const readMetadata = async (
    key: string,
  ): Promise<ChunkedSecretMetadata | null> => {
    const value = await secretStorage.getSecret(key)
    if (!value) return null
    return parseChunkedSecretMetadata(value)
  }

  return {
    getBackendStatus: () => 'obsidian-secret-storage',
    getSecret: async (key) => {
      const value = await secretStorage.getSecret(key)
      if (!value) {
        return null
      }

      const metadata = parseChunkedSecretMetadata(value)
      if (!metadata) {
        return value
      }

      const chunks: string[] = []
      for (let index = 0; index < metadata.count; index += 1) {
        const chunk = await secretStorage.getSecret(
          createChunkKey(key, index, metadata.generation),
        )
        if (chunk === null || chunk === '') return null
        chunks.push(chunk)
      }

      return chunks.join('')
    },
    setSecret: async (key, value) => {
      if (value.length > MAX_SECRET_LENGTH) {
        throw new Error('Secret is too large')
      }
      const previousMetadata = await readMetadata(key)

      if (
        value.length <= SECRET_CHUNK_SIZE &&
        !value.startsWith(CHUNKED_SECRET_PREFIX) &&
        !value.startsWith(LEGACY_CHUNKED_SECRET_PREFIX)
      ) {
        await secretStorage.setSecret(key, value)
        if (previousMetadata) {
          await cleanupChunks(key, 0, previousMetadata).catch(() => undefined)
        }
        return
      }

      const chunks = splitSecretIntoChunks(value)
      const metadata = {
        count: chunks.length,
        generation: createChunkGeneration(),
      }
      try {
        for (const [index, chunk] of chunks.entries()) {
          await secretStorage.setSecret(
            createChunkKey(key, index, metadata.generation),
            chunk,
          )
        }
        await secretStorage.setSecret(
          key,
          serializeChunkedSecretMetadata(metadata),
        )
      } catch (error) {
        await cleanupChunks(key, 0, metadata).catch(() => undefined)
        throw error
      }

      if (previousMetadata) {
        await cleanupChunks(key, 0, previousMetadata).catch(() => undefined)
      }
    },
    deleteSecret: async (key) => {
      const metadata = await readMetadata(key)
      await deleteStoredSecret(key)

      if (metadata) {
        await cleanupChunks(key, 0, metadata)
      }
    },
  }
}

function createChunkKey(
  key: string,
  index: number,
  generation?: string,
): string {
  const generationPart = generation ? `${generation}-` : ''
  return `${key}-chunk-${generationPart}${String(index).padStart(4, '0')}`
}

function createChunkGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function splitSecretIntoChunks(value: string): string[] {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += SECRET_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + SECRET_CHUNK_SIZE))
  }

  return chunks.length > 0 ? chunks : ['']
}

function serializeChunkedSecretMetadata(
  metadata: ChunkedSecretMetadata & { generation: string },
): string {
  return `${CHUNKED_SECRET_PREFIX}${metadata.generation}:${metadata.count}`
}

function parseChunkedSecretMetadata(
  value: string,
): ChunkedSecretMetadata | null {
  if (value.startsWith(CHUNKED_SECRET_PREFIX)) {
    const serialized = value.slice(CHUNKED_SECRET_PREFIX.length)
    const separatorIndex = serialized.lastIndexOf(':')
    const generation = serialized.slice(0, separatorIndex)
    const count = Number(serialized.slice(separatorIndex + 1))
    if (
      !/^[a-z0-9]+$/.test(generation) ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > MAX_SECRET_CHUNKS
    ) {
      return null
    }
    return { count, generation }
  }

  if (!value.startsWith(LEGACY_CHUNKED_SECRET_PREFIX)) {
    return null
  }

  const count = Number(value.slice(LEGACY_CHUNKED_SECRET_PREFIX.length))
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SECRET_CHUNKS) {
    return null
  }
  return { count }
}

function createNamespacedSecretStoreKey(
  namespace: SecretStoreKeyNamespace,
  parts: SecretStoreKeyParts,
): string {
  const keyParts = [
    normalizeSecretStoreKeyPart(namespace),
    normalizeSecretStoreKeyPart('provider'),
    encodeProviderId(parts.providerId),
    normalizeSecretStoreKeyPart(parts.providerType),
    normalizeSecretStoreKeyPart(parts.field),
  ]

  return keyParts.filter((part) => part.length > 0).join('-')
}

export function createSecretStoreKey(parts: SecretStoreKeyParts): string {
  return createNamespacedSecretStoreKey('aider', parts)
}

export function canUseUnversionedLegacyProviderId(value: string): boolean {
  return !/^id(?:-[0-9a-f]{4})+$/i.test(normalizeSecretStoreKeyPart(value))
}

export function createMcpEnvSecretStoreKey(serverId: string): string {
  return `aider-mcp-server-${encodeProviderId(serverId)}-env`
}

export function createMcpExecutionTrustKey(serverId: string): string {
  return `aider-mcp-server-${encodeProviderId(serverId)}-execution-trust`
}

export function createProviderRouteTrustKey(
  providerId: string,
  providerType: string,
): string {
  return `aider-provider-${encodeProviderId(providerId)}-${normalizeSecretStoreKeyPart(providerType)}-route-trust`
}

function createProviderIdParts(
  identifier: SecretStoreIdentifier,
  value: string,
): string {
  if (identifier === 'provider-id-plain') {
    return normalizeSecretStoreKeyPart(value)
  }
  if (identifier === 'provider-id-legacy-encoded') {
    return encodeLegacyProviderId(value)
  }

  return encodeProviderId(value)
}

function createLegacySecretStoreKey(
  namespace: SecretStoreKeyNamespace,
  parts: SecretStoreKeyParts,
  identifier: SecretStoreIdentifier = 'provider-id-legacy-encoded',
): string {
  const keyParts = [
    normalizeSecretStoreKeyPart(namespace),
    normalizeSecretStoreKeyPart('provider'),
    createProviderIdParts(identifier, parts.providerId),
    normalizeSecretStoreKeyPart(parts.providerType),
    normalizeSecretStoreKeyPart(parts.field),
  ]

  return keyParts.filter((part) => part.length > 0).join('-')
}

export function createLegacySmartComposerSecretStoreKey(
  parts: SecretStoreKeyParts,
): string {
  return createLegacySecretStoreKey('smart-composer', parts)
}

export function createLegacyAiderSecretStoreKey(
  parts: SecretStoreKeyParts,
): string {
  return createLegacySecretStoreKey('aider', parts)
}

export function createUnversionedLegacySmartComposerSecretStoreKey(
  parts: SecretStoreKeyParts,
): string {
  return createLegacySecretStoreKey(
    'smart-composer',
    parts,
    'provider-id-plain',
  )
}

export function createUnversionedLegacyAiderSecretStoreKey(
  parts: SecretStoreKeyParts,
): string {
  return createLegacySecretStoreKey('aider', parts, 'provider-id-plain')
}

export function createSecretStore(
  options: CreateSecretStoreOptions,
): SecretStore {
  const secretStorage = getObsidianSecretStorage(options.app)

  if (secretStorage) {
    return createObsidianSecretStore(secretStorage)
  }

  return createFallbackSecretStore()
}
