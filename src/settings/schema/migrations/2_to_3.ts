import { SettingMigration } from '../setting.types'

import { hasCompatibleProviderRoute } from './migrationUtils'

// Provider IDs at version 3 (hardcoded to avoid dependency on current constants)
const V3_PROVIDER_IDS = {
  'lm-studio': 'lm-studio',
  deepseek: 'deepseek',
  morph: 'morph',
} as const

export const NEW_DEFAULT_PROVIDERS = [
  {
    type: 'lm-studio',
    id: V3_PROVIDER_IDS['lm-studio'],
  },
  {
    type: 'deepseek',
    id: V3_PROVIDER_IDS.deepseek,
  },
  {
    type: 'morph',
    id: V3_PROVIDER_IDS.morph,
  },
] as const

export const NEW_DEFAULT_CHAT_MODELS = [
  {
    providerType: 'deepseek',
    providerId: V3_PROVIDER_IDS.deepseek,
    id: 'deepseek-chat',
    model: 'deepseek-chat',
  },
  {
    providerType: 'deepseek',
    providerId: V3_PROVIDER_IDS.deepseek,
    id: 'deepseek-reasoner',
    model: 'deepseek-reasoner',
  },
  {
    providerType: 'morph',
    providerId: V3_PROVIDER_IDS.morph,
    id: 'morph-v0',
    model: 'morph-v0',
  },
] as const

export const migrateFrom2To3: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 3

  // Handle providers migration
  if ('providers' in newData && Array.isArray(newData.providers)) {
    const existingProvidersMap = new Map(
      newData.providers.map((provider) => [provider.id, provider]),
    )
    for (const newProvider of NEW_DEFAULT_PROVIDERS) {
      if (!existingProvidersMap.has(newProvider.id)) {
        newData.providers.push({ ...newProvider })
      }
    }
  }

  // Handle chat models migration
  if ('chatModels' in newData && Array.isArray(newData.chatModels)) {
    const existingModelsMap = new Map(
      newData.chatModels.map((model) => [model.id, model]),
    )
    for (const newModel of NEW_DEFAULT_CHAT_MODELS) {
      if (
        !existingModelsMap.has(newModel.id) &&
        hasCompatibleProviderRoute(newData, newModel)
      ) {
        newData.chatModels.push({ ...newModel })
      }
    }
  }

  return newData
}
