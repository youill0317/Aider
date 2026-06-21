export type SecretBackendStatus =
  | 'obsidian-secret-storage'
  | 'insecure-settings-fallback'

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

const CHUNKED_SECRET_PREFIX = '__aider_secret_chunked_v1__:'
const SECRET_CHUNK_SIZE = 1000

type ChunkedSecretMetadata = {
  readonly count: number
}

function normalizeSecretStoreKeyPart(value: string): string {
  const normalizedValue = /[\s_-]/.test(value)
    ? value
    : value.replace(/([a-z0-9])([A-Z])/g, '$1-$2')

  return normalizedValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    getBackendStatus: () => 'insecure-settings-fallback',
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
    count: number,
  ) => {
    await Promise.all(
      Array.from({ length: Math.max(count - startIndex, 0) }, (_, index) =>
        deleteStoredSecret(createChunkKey(key, startIndex + index)),
      ),
    )
  }

  const readMetadata = async (
    key: string,
  ): Promise<ChunkedSecretMetadata | null> => {
    try {
      const value = await secretStorage.getSecret(key)
      if (!value) return null
      return parseChunkedSecretMetadata(value)
    } catch {
      return null
    }
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

      const chunks = await Promise.all(
        Array.from({ length: metadata.count }, (_, index) =>
          secretStorage.getSecret(createChunkKey(key, index)),
        ),
      )

      if (chunks.some((chunk) => chunk === null || chunk === '')) {
        return null
      }

      return chunks.join('')
    },
    setSecret: async (key, value) => {
      const previousMetadata = await readMetadata(key)

      if (
        value.length <= SECRET_CHUNK_SIZE &&
        !value.startsWith(CHUNKED_SECRET_PREFIX)
      ) {
        await secretStorage.setSecret(key, value)
        if (previousMetadata) {
          await cleanupChunks(key, 0, previousMetadata.count).catch(
            () => undefined,
          )
        }
        return
      }

      const chunks = splitSecretIntoChunks(value)
      try {
        await Promise.all(
          chunks.map((chunk, index) =>
            secretStorage.setSecret(createChunkKey(key, index), chunk),
          ),
        )
        await secretStorage.setSecret(
          key,
          serializeChunkedSecretMetadata(chunks.length),
        )
      } catch (error) {
        await cleanupChunks(key, 0, chunks.length).catch(() => undefined)
        throw error
      }

      if (previousMetadata && previousMetadata.count > chunks.length) {
        await cleanupChunks(key, chunks.length, previousMetadata.count).catch(
          () => undefined,
        )
      }
    },
    deleteSecret: async (key) => {
      const metadata = await readMetadata(key)
      await deleteStoredSecret(key)

      if (metadata) {
        await cleanupChunks(key, 0, metadata.count)
      }
    },
  }
}

function createChunkKey(key: string, index: number): string {
  return `${key}-chunk-${String(index).padStart(4, '0')}`
}

function splitSecretIntoChunks(value: string): string[] {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += SECRET_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + SECRET_CHUNK_SIZE))
  }

  return chunks.length > 0 ? chunks : ['']
}

function serializeChunkedSecretMetadata(count: number): string {
  return `${CHUNKED_SECRET_PREFIX}${count}`
}

function parseChunkedSecretMetadata(
  value: string,
): ChunkedSecretMetadata | null {
  if (!value.startsWith(CHUNKED_SECRET_PREFIX)) {
    return null
  }

  const count = Number(value.slice(CHUNKED_SECRET_PREFIX.length))
  if (!Number.isSafeInteger(count) || count < 1) {
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
