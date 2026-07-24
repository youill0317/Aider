import { SettingMigration } from '../setting.types'

export type ExistingSettingsData = Parameters<SettingMigration['migrate']>[0]
type ProviderBackedModel = {
  providerType: string
  providerId: string
}

export type DefaultProviders = readonly {
  type: string
  id: string
}[]

export const getMigratedProviders = (
  existingData: ExistingSettingsData,
  defaultProvidersForVersion: DefaultProviders,
  previousDefaultProviders: DefaultProviders,
) => {
  if (!('providers' in existingData && Array.isArray(existingData.providers))) {
    return defaultProvidersForVersion
  }

  const defaultProviders = defaultProvidersForVersion.map((provider) => {
    const existingProvider = (existingData.providers as unknown[]).find(
      (p: unknown) => (p as { id: string }).id === provider.id,
    )
    const previousDefault = previousDefaultProviders.find(
      (p) => p.id === provider.id,
    )
    if (
      existingProvider &&
      previousDefault &&
      (existingProvider as { type: string }).type === previousDefault.type
    ) {
      return mergeDefaultRecord(existingProvider, provider)
    }
    return existingProvider ?? provider
  })
  const customProviders = (existingData.providers as unknown[]).filter(
    (p: unknown) =>
      !defaultProviders.some(
        (dp: unknown) => (dp as { id: string }).id === (p as { id: string }).id,
      ),
  )

  return [...defaultProviders, ...customProviders]
}

export type DefaultChatModels = {
  id: string
  providerType: string
  providerId: string
  model: string
  reasoning_effort?: string
  thinking?: {
    budget_tokens: number
  }
  web_search_options?: {
    search_context_size?: string
  }
  enable?: boolean
}[]

export const getMigratedChatModels = (
  existingData: ExistingSettingsData,
  defaultChatModelsForVersion: DefaultChatModels,
  previousDefaultChatModels: DefaultChatModels,
) => {
  if (
    !('chatModels' in existingData && Array.isArray(existingData.chatModels))
  ) {
    return defaultChatModelsForVersion.filter((model) =>
      hasCompatibleProviderRoute(existingData, model),
    )
  }

  const defaultChatModels = defaultChatModelsForVersion.flatMap((model) => {
    const existingModel = (existingData.chatModels as unknown[]).find(
      (m: unknown) => (m as { id: string }).id === model.id,
    )
    const previousDefault = previousDefaultChatModels.find(
      (m) => m.id === model.id,
    )
    if (
      existingModel &&
      previousDefault &&
      (existingModel as { providerType: string }).providerType ===
        previousDefault.providerType &&
      (existingModel as { providerId: string }).providerId ===
        previousDefault.providerId &&
      (existingModel as { model: string }).model === previousDefault.model
    ) {
      return [mergeDefaultRecord(existingModel, model)]
    }
    if (existingModel) {
      return [existingModel]
    }
    return hasCompatibleProviderRoute(existingData, model) ? [model] : []
  })
  const customChatModels = (existingData.chatModels as unknown[]).filter(
    (m: unknown) => {
      return !defaultChatModels.some(
        (dm: unknown) => (dm as { id: string }).id === (m as { id: string }).id,
      )
    },
  )

  return [...defaultChatModels, ...customChatModels]
}

export function hasCompatibleProviderRoute(
  data: ExistingSettingsData,
  model: ProviderBackedModel,
): boolean {
  if (!Array.isArray(data.providers)) return true

  const provider = data.providers.find(
    (value) => isRecord(value) && value.id === model.providerId,
  )
  return isRecord(provider) && provider.type === model.providerType
}

function mergeDefaultRecord(
  existingValue: unknown,
  defaultValue: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(existingValue)) return defaultValue

  const merged: Record<string, unknown> = {
    ...existingValue,
    ...defaultValue,
  }
  for (const [key, nestedDefault] of Object.entries(defaultValue)) {
    const nestedExisting = existingValue[key]
    if (isRecord(nestedDefault) && isRecord(nestedExisting)) {
      merged[key] = { ...nestedDefault, ...nestedExisting }
    }
  }
  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
