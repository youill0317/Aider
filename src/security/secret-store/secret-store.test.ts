import { createSecretStore, createSecretStoreKey } from './secret-store'

describe('SecretStore backend selection', () => {
  it('selects Obsidian secretStorage when available', async () => {
    // Given: an Obsidian app object that exposes secretStorage.
    const secretStorageValues = new Map<string, string>()
    const app = {
      secretStorage: {
        getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
        setSecret: async (key: string, value: string) => {
          secretStorageValues.set(key, value)
        },
      },
    }

    // When: a secret store is created from that app object.
    const store = createSecretStore({ app })
    await store.setSecret('smart-composer-provider-openai-api-key', 'secret')

    // Then: the Obsidian backend is selected and roundtrips values.
    expect(store.getBackendStatus()).toBe('obsidian-secret-storage')
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBe('secret')
  })

  it('roundtrips secrets through Obsidian secretStorage backend', async () => {
    // Given: a secure Obsidian secretStorage backend.
    const secretStorageValues = new Map<string, string>()
    const app = {
      secretStorage: {
        getSecret: async (key: string) => secretStorageValues.get(key) ?? '',
        setSecret: async (key: string, value: string) => {
          secretStorageValues.set(key, value)
        },
      },
    }
    const secretId = 'smart-composer-provider-openai-api-key'

    // When: a secret is stored and read by stable id.
    const store = createSecretStore({ app })
    await store.setSecret(secretId, 'sk-test-roundtrip')

    // Then: the backend reports secure storage and returns only through getSecret.
    expect(store.getBackendStatus()).toBe('obsidian-secret-storage')
    await expect(store.getSecret(secretId)).resolves.toBe('sk-test-roundtrip')
  })

  it('treats null from Obsidian secretStorage as missing secret', async () => {
    // Given: Obsidian secretStorage reports a missing secret as null.
    const store = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async () => null,
          setSecret: async () => undefined,
        },
      },
    })

    // When/Then: the secure backend accepts the documented missing-secret shape.
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBeNull()
  })

  it('falls back when app.secretStorage is absent', async () => {
    // Given: an older Obsidian app object without secretStorage.
    const app = {}

    // When: a secret store is created from that app object.
    const store = createSecretStore({ app })
    await store.setSecret('smart-composer-provider-openai-api-key', 'secret')

    // Then: the explicit insecure fallback remains functional.
    expect(store.getBackendStatus()).toBe('insecure-settings-fallback')
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBe('secret')
  })

  it('marks fallback as insecure-settings-fallback', () => {
    // Given: a runtime without the Obsidian secure storage API.
    const store = createSecretStore({ app: undefined })

    // When/Then: backend status is explicit and not reported as secure.
    expect(store.getBackendStatus()).toBe('insecure-settings-fallback')
  })

  it('reports fallback without throwing', async () => {
    // Given: no app object is available in the current runtime.
    const store = createSecretStore({ app: undefined })

    // When: callers use the fallback backend with the same API surface.
    await store.setSecret('smart-composer-provider-openai-api-key', 'secret')

    // Then: the backend is explicit and remains usable.
    expect(store.getBackendStatus()).toBe('insecure-settings-fallback')
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBe('secret')
  })

  it('falls back when app.secretStorage is malformed', async () => {
    // Given: a runtime exposes a malformed secretStorage object.
    const app = {
      secretStorage: {},
    }

    // When: a secret store is created from that app object.
    const store = createSecretStore({ app })
    await store.setSecret('smart-composer-provider-openai-api-key', 'secret')

    // Then: the malformed shape is not reported as secure.
    expect(store.getBackendStatus()).toBe('insecure-settings-fallback')
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBe('secret')
  })

  it('reports backend status to callers', () => {
    // Given: one runtime with secure storage and one without it.
    const secureStore = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async () => '',
          setSecret: async () => undefined,
        },
      },
    })
    const fallbackStore = createSecretStore({ app: {} })

    // When/Then: callers can branch on explicit backend status.
    expect(secureStore.getBackendStatus()).toBe('obsidian-secret-storage')
    expect(fallbackStore.getBackendStatus()).toBe('insecure-settings-fallback')
  })

  it('calls Obsidian secretStorage methods with original receiver', async () => {
    // Given: a host secretStorage implementation depends on its receiver.
    class ReceiverBoundSecretStorage {
      private readonly values = new Map<string, string>()

      async getSecret(key: string) {
        return this.values.get(key) ?? ''
      }

      async setSecret(key: string, value: string) {
        this.values.set(key, value)
      }
    }
    const secretStorage = new ReceiverBoundSecretStorage()

    // When: a secret is stored through the adapter.
    const store = createSecretStore({
      app: {
        secretStorage,
      },
    })
    await store.setSecret('smart-composer-provider-openai-api-key', 'secret')

    // Then: the original host method receiver is preserved.
    await expect(
      store.getSecret('smart-composer-provider-openai-api-key'),
    ).resolves.toBe('secret')
  })
})

describe('SecretStore deletion contract', () => {
  it('deletes or tombstones secrets by stable id', async () => {
    // Given: secure, tombstone-only, and fallback stores share one stable id.
    const secretId = 'smart-composer-provider-openai-api-key'
    const nativeDeleteValues = new Map<string, string>()
    const tombstoneValues = new Map<string, string>()
    const nativeDeleteCalls: string[] = []
    const nativeDeleteStore = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async (key: string) => nativeDeleteValues.get(key) ?? '',
          setSecret: async (key: string, value: string) => {
            nativeDeleteValues.set(key, value)
          },
          deleteSecret: async (key: string) => {
            nativeDeleteCalls.push(key)
            nativeDeleteValues.delete(key)
          },
        },
      },
    })
    const tombstoneStore = createSecretStore({
      app: {
        secretStorage: {
          getSecret: async (key: string) => tombstoneValues.get(key) ?? '',
          setSecret: async (key: string, value: string) => {
            tombstoneValues.set(key, value)
          },
        },
      },
    })
    const fallbackStore = createSecretStore({ app: {} })

    // When: each backend deletes the same stable id.
    await nativeDeleteStore.setSecret(secretId, 'native-secret')
    await tombstoneStore.setSecret(secretId, 'tombstone-secret')
    await fallbackStore.setSecret(secretId, 'fallback-secret')
    await nativeDeleteStore.deleteSecret(secretId)
    await tombstoneStore.deleteSecret(secretId)
    await fallbackStore.deleteSecret(secretId)

    // Then: native deletion removes the value, older storage tombstones it, and fallback deletes it.
    expect(nativeDeleteCalls).toEqual([secretId])
    expect(nativeDeleteValues.has(secretId)).toBe(false)
    expect(tombstoneValues.get(secretId)).toBe('')
    await expect(nativeDeleteStore.getSecret(secretId)).resolves.toBeNull()
    await expect(tombstoneStore.getSecret(secretId)).resolves.toBeNull()
    await expect(fallbackStore.getSecret(secretId)).resolves.toBeNull()
  })
})

describe('SecretStore key contract', () => {
  it('generates valid Obsidian secret ids', () => {
    // Given: provider and secret field identifiers with mixed separators.
    const key = createSecretStoreKey({
      providerId: 'OpenAI Plan',
      providerType: 'openai-plan',
      field: 'refreshToken',
    })

    // When/Then: the generated id uses only lowercase letters, numbers, and dashes.
    expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(key).toContain('aider-provider-id-')
    expect(key).toContain('openai-plan-refresh-token')
  })

  it('does not serialize secret values in store references', () => {
    // Given: provider metadata and a secret value that must never become an id.
    const secretValue = 'sk-secret-value-that-must-not-appear'

    // When: callers create the stable secret reference.
    const key = createSecretStoreKey({
      providerId: 'openai',
      providerType: 'openai',
      field: 'apiKey',
    })

    // Then: the reference is a non-secret id, not serialized credential material.
    expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(key).not.toContain(secretValue)
    expect(JSON.stringify({ key })).not.toContain(secretValue)
  })

  it('generates distinct ids for provider ids with the same slug', () => {
    // Given: user-defined provider ids can differ only by punctuation or case.
    const dashKey = createSecretStoreKey({
      providerId: 'foo-bar',
      providerType: 'openai',
      field: 'apiKey',
    })
    const underscoreKey = createSecretStoreKey({
      providerId: 'foo_bar',
      providerType: 'openai',
      field: 'apiKey',
    })
    const spacedKey = createSecretStoreKey({
      providerId: 'Foo Bar',
      providerType: 'openai',
      field: 'apiKey',
    })

    // When/Then: each valid provider id maps to a collision-resistant secret id.
    expect(new Set([dashKey, underscoreKey, spacedKey]).size).toBe(3)
    expect(dashKey).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(underscoreKey).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(spacedKey).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('does not let normalized provider ids alias encoded provider ids', () => {
    // Given: one raw provider id looks like another id's encoded suffix.
    const providerWithMarkup = createSecretStoreKey({
      providerId: 'Foo Bar',
      providerType: 'openai',
      field: 'apiKey',
    })
    const providerWithSuffix = createSecretStoreKey({
      providerId: 'foo-bar-13df66aa',
      providerType: 'openai',
      field: 'apiKey',
    })

    // When/Then: reversible provider id encoding keeps both secret ids distinct.
    expect(providerWithMarkup).not.toBe(providerWithSuffix)
  })
})
