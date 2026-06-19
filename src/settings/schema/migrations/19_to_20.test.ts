import { migrateFrom19To20 } from './19_to_20'

describe('Migration from v19 to v20', () => {
  it('increments version to 20', () => {
    const result = migrateFrom19To20({ version: 19 })

    expect(result.version).toBe(20)
  })

  it('adds voyage-context-4 while preserving custom embedding models', () => {
    const customModel = {
      providerType: 'custom',
      providerId: 'custom-provider',
      id: 'custom/embedding',
      model: 'embedding',
      dimension: 384,
    }

    const result = migrateFrom19To20({
      version: 19,
      embeddingModels: [customModel],
    })

    expect(result.embeddingModels).toEqual([
      customModel,
      getDefaultVoyageContextualEmbeddingModel(),
    ])
  })

  it('refreshes an existing default voyage-context-4 model entry', () => {
    const result = migrateFrom19To20({
      version: 19,
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
