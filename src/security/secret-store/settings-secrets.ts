import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { LLMProvider } from '../../types/provider.types'

import { SecretStore, createSecretStoreKey } from './secret-store'

type OAuthSecretField = 'accessToken' | 'refreshToken'

type OAuthState = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

type ProviderWithOAuth = Extract<
  LLMProvider,
  { readonly type: 'anthropic-plan' | 'openai-plan' | 'gemini-plan' }
> & {
  readonly oauth?: OAuthState
}

const OAUTH_SECRET_FIELDS: readonly OAuthSecretField[] = [
  'accessToken',
  'refreshToken',
]

function isNonEmptySecret(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasOAuth(provider: LLMProvider): provider is ProviderWithOAuth {
  switch (provider.type) {
    case 'anthropic-plan':
    case 'openai-plan':
    case 'gemini-plan':
      return true
    case 'anthropic':
    case 'openai':
    case 'gemini':
    case 'xai':
    case 'deepseek':
    case 'perplexity':
    case 'mistral':
    case 'voyage':
    case 'openrouter':
    case 'ollama':
    case 'lm-studio':
    case 'azure-openai':
    case 'openai-compatible':
      return false
  }
}

function providerSecretKey(
  provider: LLMProvider,
  field: 'apiKey' | OAuthSecretField,
): string {
  return createSecretStoreKey({
    providerId: provider.id,
    providerType: provider.type,
    field,
  })
}

async function writeSecret(
  secretStore: SecretStore,
  key: string,
  value: string,
): Promise<boolean> {
  try {
    await secretStore.setSecret(key, value)
    return true
  } catch {
    return false
  }
}

async function readSecret(
  secretStore: SecretStore,
  key: string,
): Promise<string | null> {
  try {
    return await secretStore.getSecret(key)
  } catch {
    return null
  }
}

async function hydrateProvider(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<LLMProvider> {
  const hydratedProvider = { ...provider }
  const apiKey = await readSecret(
    secretStore,
    providerSecretKey(provider, 'apiKey'),
  )

  if (!isNonEmptySecret(hydratedProvider.apiKey) && apiKey !== null) {
    hydratedProvider.apiKey = apiKey
  }

  if (!hasOAuth(hydratedProvider) || !hydratedProvider.oauth) {
    return hydratedProvider
  }

  const hydratedOauth = { ...hydratedProvider.oauth }

  for (const field of OAUTH_SECRET_FIELDS) {
    const secret = await readSecret(
      secretStore,
      providerSecretKey(provider, field),
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
): Promise<LLMProvider> {
  if (secretStore.getBackendStatus() === 'insecure-settings-fallback') {
    return provider
  }

  const sanitizedProvider = { ...provider }

  if (isNonEmptySecret(provider.apiKey)) {
    const didWriteApiKey = await writeSecret(
      secretStore,
      providerSecretKey(provider, 'apiKey'),
      provider.apiKey,
    )
    if (didWriteApiKey) {
      delete sanitizedProvider.apiKey
    }
  }

  if (!hasOAuth(provider) || !provider.oauth || !hasOAuth(sanitizedProvider)) {
    return sanitizedProvider
  }

  const sanitizedOauth = { ...provider.oauth }

  for (const field of OAUTH_SECRET_FIELDS) {
    if (!isNonEmptySecret(provider.oauth[field])) {
      continue
    }

    const didWriteOAuthSecret = await writeSecret(
      secretStore,
      providerSecretKey(provider, field),
      provider.oauth[field],
    )
    if (didWriteOAuthSecret) {
      sanitizedOauth[field] = ''
    }
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
      await secretStore.deleteSecret(
        providerSecretKey(previousProvider, 'apiKey'),
      )
    }
  }
}

async function deleteAllProviderSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<void> {
  await secretStore.deleteSecret(providerSecretKey(provider, 'apiKey'))

  if (hasOAuth(provider)) {
    await deleteOAuthSecrets(provider, secretStore)
  }
}

async function deleteOAuthSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<void> {
  for (const field of OAUTH_SECRET_FIELDS) {
    await secretStore.deleteSecret(providerSecretKey(provider, field))
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
    settings.providers.map((provider) =>
      sanitizeProvider(provider, secretStore),
    ),
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
  const persistedSettings = await sanitizeSettingsForPersistence(
    nextSettings,
    secretStore,
    previousSettings,
  )
  await saveData(persistedSettings)
}
