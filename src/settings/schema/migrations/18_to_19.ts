import type { SettingMigration } from '../setting.types'

const DEFAULT_VOYAGE_CONTEXTUAL_EMBEDDING_MODEL = {
  providerType: 'voyage',
  providerId: 'voyage',
  id: 'voyage/voyage-context-4',
  model: 'voyage-context-4',
  dimension: 1024,
} as const

export const migrateFrom18To19: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 19
  newData.embeddingModels = getMigratedEmbeddingModels(newData)

  return newData
}

function getMigratedEmbeddingModels(data: Record<string, unknown>): unknown[] {
  if (!Array.isArray(data.embeddingModels)) {
    return [DEFAULT_VOYAGE_CONTEXTUAL_EMBEDDING_MODEL]
  }

  const customModels = data.embeddingModels.filter(
    (model) =>
      !isRecord(model) ||
      String(model.id) !== DEFAULT_VOYAGE_CONTEXTUAL_EMBEDDING_MODEL.id,
  )

  return [...customModels, DEFAULT_VOYAGE_CONTEXTUAL_EMBEDDING_MODEL]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
