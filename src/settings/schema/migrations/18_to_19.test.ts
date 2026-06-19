import { migrateFrom18To19 } from './18_to_19'

describe('Migration from v18 to v19', () => {
  it('increments version to 19', () => {
    const result = migrateFrom18To19({ version: 18 })

    expect(result.version).toBe(19)
  })

  it('adds voyage-context-4 while preserving custom embedding models', () => {
    const customModel = {
      providerType: 'custom',
      providerId: 'custom-provider',
      id: 'custom/embedding',
      model: 'embedding',
      dimension: 384,
    }

    const result = migrateFrom18To19({
      version: 18,
      embeddingModels: [customModel],
    })

    expect(result.embeddingModels).toEqual([
      customModel,
      getDefaultVoyageContextualEmbeddingModel(),
    ])
  })

  it('refreshes an existing default voyage-context-4 model entry', () => {
    const result = migrateFrom18To19({
      version: 18,
      embeddingModels: [
        {
          providerType: 'voyage',
          providerId: 'old-voyage',
          id: 'voyage/voyage-context-4',
          model: 'old-context-model',
          dimension: 256,
        },
      ],
    })

    expect(result.embeddingModels).toEqual([
      getDefaultVoyageContextualEmbeddingModel(),
    ])
  })
})

function getDefaultVoyageContextualEmbeddingModel() {
  return {
    providerType: 'voyage',
    providerId: 'voyage',
    id: 'voyage/voyage-context-4',
    model: 'voyage-context-4',
    dimension: 1024,
  }
}
