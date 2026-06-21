import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { LLMProvider } from '../../types/provider.types'

import {
  OAUTH_SECRET_FIELDS,
  deleteProviderSecrets,
  hasOAuth,
  isNonEmptySecret,
  providerSecretKeys,
  readProviderSecret,
  writeRequiredSecret,
} from './provider-secret-utils'
import type { SecretStore } from './secret-store'

async function hydrateProvider(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<LLMProvider> {
  const hydratedProvider = { ...provider }
  const apiKey = await readProviderSecret(
    secretStore,
    providerSecretKeys(provider, 'apiKey'),
  )

  if (!isNonEmptySecret(hydratedProvider.apiKey) && apiKey !== null) {
    hydratedProvider.apiKey = apiKey
  }

  if (!hasOAuth(hydratedProvider) || !hydratedProvider.oauth) {
    return hydratedProvider
  }

  const hydratedOauth = { ...hydratedProvider.oauth }

  for (const field of OAUTH_SECRET_FIELDS) {
    const secret = await readProviderSecret(
      secretStore,
      providerSecretKeys(provider, field),
    )
    if (!isNonEmptySecret(hydratedOauth[field]) && secret !== null) {
      hydratedOauth[field] = secret
    }
  }

  return {
    ...hydratedProvider,
    oauth: hydratedOauth,
  }
}

async function sanitizeProvider(
  provider: LLMProvider,
  secretStore: SecretStore,
  previousProvider?: LLMProvider,
): Promise<LLMProvider> {
  if (secretStore.getBackendStatus() === 'insecure-settings-fallback') {
    return provider
  }

  const sanitizedProvider = { ...provider }

  if (isNonEmptySecret(provider.apiKey)) {
    if (provider.apiKey !== previousProvider?.apiKey) {
      await writeRequiredSecret(
        secretStore,
        providerSecretKeys(provider, 'apiKey').current,
        provider.apiKey,
      )
    }
    delete sanitizedProvider.apiKey
  }

  if (!hasOAuth(provider) || !provider.oauth || !hasOAuth(sanitizedProvider)) {
    return sanitizedProvider
  }

  const sanitizedOauth = { ...provider.oauth }
  const previousOauth =
    previousProvider && hasOAuth(previousProvider)
      ? previousProvider.oauth
      : undefined

  for (const field of OAUTH_SECRET_FIELDS) {
    if (!isNonEmptySecret(provider.oauth[field])) {
      continue
    }

    if (provider.oauth[field] !== previousOauth?.[field]) {
      await writeRequiredSecret(
        secretStore,
        providerSecretKeys(provider, field).current,
        provider.oauth[field],
      )
    }
    sanitizedOauth[field] = ''
  }

  return {
    ...sanitizedProvider,
    oauth: sanitizedOauth,
  }
}

async function deleteRemovedProviderSecrets(
  previousSettings: SmartComposerSettings | undefined,
  nextRuntimeSettings: SmartComposerSettings,
  secretStore: SecretStore,
): Promise<void> {
  if (
    !previousSettings ||
    secretStore.getBackendStatus() === 'insecure-settings-fallback'
  ) {
    return
  }

  for (const previousProvider of previousSettings.providers) {
    const nextProvider = nextRuntimeSettings.providers.find(
      (provider) => provider.id === previousProvider.id,
    )

    if (!nextProvider) {
      await deleteAllProviderSecrets(previousProvider, secretStore)
      continue
    }

    if (
      hasOAuth(previousProvider) &&
      previousProvider.oauth &&
      (!hasOAuth(nextProvider) || !nextProvider.oauth)
    ) {
      await deleteOAuthSecrets(previousProvider, secretStore)
    }

    if (
      isNonEmptySecret(previousProvider.apiKey) &&
      !isNonEmptySecret(nextProvider.apiKey)
    ) {
      await deleteProviderSecrets(
        secretStore,
        providerSecretKeys(previousProvider, 'apiKey'),
      )
    }
  }
}

async function deleteAllProviderSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<void> {
  await deleteProviderSecrets(
    secretStore,
    providerSecretKeys(provider, 'apiKey'),
  )

  if (hasOAuth(provider)) {
    await deleteOAuthSecrets(provider, secretStore)
  }
}

async function deleteOAuthSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<void> {
  for (const field of OAUTH_SECRET_FIELDS) {
    await deleteProviderSecrets(
      secretStore,
      providerSecretKeys(provider, field),
    )
  }
}

export async function hydrateSettingsSecrets(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
): Promise<SmartComposerSettings> {
  const providers = await Promise.all(
    settings.providers.map((provider) =>
      hydrateProvider(provider, secretStore),
    ),
  )

  return {
    ...settings,
    providers,
  }
}

export async function sanitizeSettingsForPersistence(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
  previousSettings?: SmartComposerSettings,
): Promise<SmartComposerSettings> {
  const providers = await Promise.all(
    settings.providers.map((provider) => {
      const previousProvider = previousSettings?.providers.find(
        (candidate) =>
          candidate.id === provider.id && candidate.type === provider.type,
      )
      return sanitizeProvider(provider, secretStore, previousProvider)
    }),
  )
  const sanitizedSettings = {
    ...settings,
    providers,
  }

  await deleteRemovedProviderSecrets(previousSettings, settings, secretStore)

  return sanitizedSettings
}

export async function persistSettingsUpdate({
  previousSettings,
  nextSettings,
  secretStore,
  publishRuntimeSettings,
  saveData,
}: {
  previousSettings: SmartComposerSettings
  nextSettings: SmartComposerSettings
  secretStore: SecretStore
  publishRuntimeSettings: (settings: SmartComposerSettings) => void
  saveData: (settings: SmartComposerSettings) => Promise<void>
}): Promise<void> {
  publishRuntimeSettings(nextSettings)
  try {
    const persistedSettings = await sanitizeSettingsForPersistence(
      nextSettings,
      secretStore,
      previousSettings,
    )
    await saveData(persistedSettings)
  } catch (error) {
    publishRuntimeSettings(previousSettings)
    throw error
  }
}
