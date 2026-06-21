import type { LLMProvider } from '../../types/provider.types'

import {
  createLegacyAiderSecretStoreKey,
  createLegacySmartComposerSecretStoreKey,
  createSecretStoreKey,
  createUnversionedLegacyAiderSecretStoreKey,
  createUnversionedLegacySmartComposerSecretStoreKey,
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
  readonly legacy: readonly string[]
}

export const OAUTH_SECRET_FIELDS: readonly OAuthSecretField[] = [
  'accessToken',
  'refreshToken',
]

export function isNonEmptySecret(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function isProviderSecretKeys(
  key: string | readonly string[] | ProviderSecretKeys,
): key is ProviderSecretKeys {
  if (typeof key !== 'object' || key === null) {
    return false
  }

  const candidate = key as {
    current?: unknown
    legacy?: unknown
  }

  return (
    typeof candidate.current === 'string' &&
    Array.isArray(candidate.legacy) &&
    candidate.legacy.every((entry) => typeof entry === 'string')
  )
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
    legacy: Array.from(
      new Set([
        createLegacySmartComposerSecretStoreKey(keyParts),
        createLegacyAiderSecretStoreKey(keyParts),
        createUnversionedLegacySmartComposerSecretStoreKey(keyParts),
        createUnversionedLegacyAiderSecretStoreKey(keyParts),
      ]).values(),
    ).filter((legacyKey) => legacyKey !== createSecretStoreKey(keyParts)),
  }
}

export async function writeSecret(
  secretStore: SecretStore,
  key: string | readonly string[] | ProviderSecretKeys,
  value: string,
): Promise<boolean> {
  const keys: readonly string[] = Array.isArray(key)
    ? key
    : isProviderSecretKeys(key)
      ? [key.current, ...key.legacy]
      : [key]
  let lastError: unknown

  for (const candidateKey of new Set(keys)) {
    try {
      await writeRequiredSecret(secretStore, candidateKey, value)
      return true
    } catch (error) {
      lastError = error
      continue
    }
  }

  if (lastError === undefined) {
    return false
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw new Error('Failed to write secret')
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
  const allKeys = [keys.current, ...keys.legacy]

  for (const key of allKeys) {
    const secret = await readSecret(secretStore, key)
    if (secret === null) {
      continue
    }

    if (
      key !== keys.current &&
      secretStore.getBackendStatus() !== 'insecure-settings-fallback'
    ) {
      try {
        await writeSecret(secretStore, keys.current, secret)
        await Promise.all(
          keys.legacy.map((legacyKey) => secretStore.deleteSecret(legacyKey)),
        )
      } catch (error) {
        void error
      }
    }

    return secret
  }

  return null
}

export async function deleteProviderSecrets(
  secretStore: SecretStore,
  keys: ProviderSecretKeys,
): Promise<void> {
  const allKeys = [keys.current, ...keys.legacy]
  await Promise.all(
    allKeys.map((secretKey) => secretStore.deleteSecret(secretKey)),
  )
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
