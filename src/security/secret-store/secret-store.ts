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
  return {
    getBackendStatus: () => 'obsidian-secret-storage',
    getSecret: async (key) => {
      const value = await secretStorage.getSecret(key)
      return value === '' ? null : value
    },
    setSecret: async (key, value) => {
      await secretStorage.setSecret(key, value)
    },
    deleteSecret: async (key) => {
      if (secretStorage.deleteSecret) {
        await secretStorage.deleteSecret(key)
        return
      }

      await secretStorage.setSecret(key, '')
    },
  }
}

export function createSecretStoreKey(parts: SecretStoreKeyParts): string {
  const keyParts = [
    normalizeSecretStoreKeyPart('smart-composer'),
    normalizeSecretStoreKeyPart('provider'),
    encodeProviderId(parts.providerId),
    normalizeSecretStoreKeyPart(parts.providerType),
    normalizeSecretStoreKeyPart(parts.field),
  ]

  return keyParts.filter((part) => part.length > 0).join('-')
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
