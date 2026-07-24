import { migrateFrom17To18 } from './17_to_18'

describe('Migration from v17 to v18', () => {
  it('should increment version to 18', () => {
    const result = migrateFrom17To18({ version: 17 })

    expect(result.version).toBe(18)
  })

  it('should add the Voyage AI provider while preserving custom providers', () => {
    const result = migrateFrom17To18({
      version: 17,
      providers: [
        { type: 'openai', id: 'openai', apiKey: 'openai-key' },
        { type: 'custom', id: 'custom-provider', apiKey: 'custom-key' },
      ],
    })

    expect(
      Array.isArray(result.providers) &&
        result.providers.find(
          (provider) =>
            isProviderRecord(provider) && provider.type === 'voyage',
        ),
    ).toEqual({
      type: 'voyage',
      id: 'voyage',
    })
    expect(
      Array.isArray(result.providers) &&
        result.providers.find(
          (provider) =>
            isProviderRecord(provider) &&
            provider.id === 'custom-provider' &&
            provider.type === 'custom',
        ),
    ).toBeDefined()
  })

  it('should add the Voyage AI embedding models while preserving custom models', () => {
    const result = migrateFrom17To18({
      version: 17,
      embeddingModels: [
        {
          providerType: 'custom',
          providerId: 'custom-provider',
          id: 'custom/embedding',
          model: 'embedding',
          dimension: 384,
        },
      ],
    })

    expect(result.embeddingModels).toEqual([
      {
        providerType: 'custom',
        providerId: 'custom-provider',
        id: 'custom/embedding',
        model: 'embedding',
        dimension: 384,
      },
      ...getDefaultVoyageEmbeddingModels(),
    ])
  })

  it('should preserve custom models that collide with Voyage defaults', () => {
    const customModels = [
      {
        providerType: 'custom',
        providerId: 'private-voyage',
        id: 'voyage/voyage-4',
        model: 'private-model',
        dimension: 256,
      },
      {
        providerType: 'custom',
        providerId: 'private-voyage',
        id: 'voyage/voyage-4-large',
        model: 'private-large-model',
        dimension: 512,
      },
    ]
    const result = migrateFrom17To18({
      version: 17,
      embeddingModels: customModels,
    })

    for (const customModel of customModels) {
      expect(
        (result.embeddingModels as { id: string }[]).filter(
          ({ id }) => id === customModel.id,
        ),
      ).toEqual([customModel])
    }
  })

  it('keeps only the first model for each colliding Voyage default ID', () => {
    const first = {
      providerType: 'custom',
      providerId: 'first-provider',
      id: 'voyage/voyage-4',
      model: 'first-model',
      dimension: 256,
    }
    const duplicate = {
      ...first,
      providerId: 'second-provider',
      model: 'second-model',
    }
    const result = migrateFrom17To18({
      version: 17,
      embeddingModels: [first, duplicate],
    })

    expect(
      (result.embeddingModels as { id: string }[]).filter(
        ({ id }) => id === first.id,
      ),
    ).toEqual([first])
  })
})

function getDefaultVoyageEmbeddingModels() {
  return [
    {
      providerType: 'voyage',
      providerId: 'voyage',
      id: 'voyage/voyage-4-large',
      model: 'voyage-4-large',
      dimension: 1024,
    },
    {
      providerType: 'voyage',
      providerId: 'voyage',
      id: 'voyage/voyage-4',
      model: 'voyage-4',
      dimension: 1024,
    },
    {
      providerType: 'voyage',
      providerId: 'voyage',
      id: 'voyage/voyage-4-lite',
      model: 'voyage-4-lite',
      dimension: 1024,
    },
  ]
}

function isProviderRecord(
  value: unknown,
): value is { readonly type: string; readonly id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'id' in value &&
    typeof value.type === 'string' &&
    typeof value.id === 'string'
  )
}
