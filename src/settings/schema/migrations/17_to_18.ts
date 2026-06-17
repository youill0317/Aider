import type { SettingMigration } from '../setting.types'

import { getMigratedProviders } from './migrationUtils'

const DEFAULT_PROVIDERS_V18 = [
  { type: 'anthropic-plan', id: 'anthropic-plan' },
  { type: 'openai-plan', id: 'openai-plan' },
  { type: 'gemini-plan', id: 'gemini-plan' },
  { type: 'anthropic', id: 'anthropic' },
  { type: 'openai', id: 'openai' },
  { type: 'gemini', id: 'gemini' },
  { type: 'xai', id: 'xai' },
  { type: 'deepseek', id: 'deepseek' },
  { type: 'mistral', id: 'mistral' },
  { type: 'voyage', id: 'voyage' },
  { type: 'perplexity', id: 'perplexity' },
  { type: 'openrouter', id: 'openrouter' },
  { type: 'ollama', id: 'ollama' },
  { type: 'lm-studio', id: 'lm-studio' },
] as const

const DEFAULT_VOYAGE_EMBEDDING_MODELS = [
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
] as const

export const migrateFrom17To18: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 18
  newData.providers = getMigratedProviders(newData, DEFAULT_PROVIDERS_V18)
  newData.embeddingModels = getMigratedEmbeddingModels(newData)

  return newData
}

function getMigratedEmbeddingModels(data: Record<string, unknown>): unknown[] {
  if (!Array.isArray(data.embeddingModels)) {
    return [...DEFAULT_VOYAGE_EMBEDDING_MODELS]
  }

  const defaultModelIds = new Set<string>(
    DEFAULT_VOYAGE_EMBEDDING_MODELS.map((model) => model.id),
  )
  const customModels = data.embeddingModels.filter(
    (model) => !isRecord(model) || !defaultModelIds.has(String(model.id)),
  )

  return [...customModels, ...DEFAULT_VOYAGE_EMBEDDING_MODELS]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
