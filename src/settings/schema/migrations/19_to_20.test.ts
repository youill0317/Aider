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

  it('preserves a custom voyage-context-4 collision', () => {
    const customModel = {
      providerType: 'custom',
      providerId: 'private-voyage',
      id: 'voyage/voyage-context-4',
      model: 'private-context-model',
      dimension: 256,
    }
    const result = migrateFrom19To20({
      version: 19,
      embeddingModels: [customModel],
    })

    expect(result.embeddingModels).toEqual([customModel])
  })

  it('keeps the first voyage-context-4 collision', () => {
    const first = {
      providerType: 'custom',
      providerId: 'first-provider',
      id: 'voyage/voyage-context-4',
      model: 'first-model',
      dimension: 256,
    }
    const duplicate = {
      ...first,
      providerId: 'second-provider',
      model: 'second-model',
    }
    const result = migrateFrom19To20({
      version: 19,
      embeddingModels: [first, duplicate],
    })

    expect(result.embeddingModels).toEqual([first])
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
