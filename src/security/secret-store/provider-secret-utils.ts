import type { LLMProvider } from '../../types/provider.types'

import {
  createLegacySmartComposerSecretStoreKey,
  createSecretStoreKey,
} from './secret-store'
import type { SecretStore } from './secret-store'

export type OAuthSecretField = 'accessToken' | 'refreshToken'

type OAuthState = {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

export type ProviderWithOAuth = Extract<
  LLMProvider,
  { readonly type: 'anthropic-plan' | 'openai-plan' | 'gemini-plan' }
> & {
  readonly oauth?: OAuthState
}

type ProviderSecretKeys = {
  readonly current: string
  readonly legacy: string
}

export const OAUTH_SECRET_FIELDS: readonly OAuthSecretField[] = [
  'accessToken',
  'refreshToken',
]

export function isNonEmptySecret(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function hasOAuth(provider: LLMProvider): provider is ProviderWithOAuth {
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

export function providerSecretKeys(
  provider: LLMProvider,
  field: 'apiKey' | OAuthSecretField,
): ProviderSecretKeys {
  const keyParts = {
    providerId: provider.id,
    providerType: provider.type,
    field,
  }

  return {
    current: createSecretStoreKey(keyParts),
    legacy: createLegacySmartComposerSecretStoreKey(keyParts),
  }
}

export async function writeSecret(
  secretStore: SecretStore,
  key: string,
  value: string,
): Promise<boolean> {
  try {
    await writeRequiredSecret(secretStore, key, value)
    return true
  } catch {
    return false
  }
}

export async function writeRequiredSecret(
  secretStore: SecretStore,
  key: string,
  value: string,
): Promise<void> {
  await secretStore.setSecret(key, value)
}

export async function readProviderSecret(
  secretStore: SecretStore,
  keys: ProviderSecretKeys,
): Promise<string | null> {
  const currentSecret = await readSecret(secretStore, keys.current)

  if (currentSecret !== null) {
    return currentSecret
  }

  const legacySecret = await readSecret(secretStore, keys.legacy)

  if (legacySecret === null) {
    return null
  }

  if (secretStore.getBackendStatus() !== 'insecure-settings-fallback') {
    const didCopyLegacySecret = await writeSecret(
      secretStore,
      keys.current,
      legacySecret,
    )
    if (didCopyLegacySecret) {
      await secretStore.deleteSecret(keys.legacy)
    }
  }

  return legacySecret
}

export async function deleteProviderSecrets(
  secretStore: SecretStore,
  keys: ProviderSecretKeys,
): Promise<void> {
  await Promise.all([
    secretStore.deleteSecret(keys.current),
    secretStore.deleteSecret(keys.legacy),
  ])
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
