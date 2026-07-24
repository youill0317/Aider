import type { LLMProvider } from '../../types/provider.types'

import {
  canUseUnversionedLegacyProviderId,
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

export type ProviderSecretKeys = {
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
  options: { includeUnversionedLegacy?: boolean } = {},
): ProviderSecretKeys {
  const keyParts = {
    providerId: provider.id,
    providerType: provider.type,
    field,
  }
  const current = createSecretStoreKey(keyParts)

  const legacy = [
    createLegacySmartComposerSecretStoreKey(keyParts),
    createLegacyAiderSecretStoreKey(keyParts),
    ...(options.includeUnversionedLegacy &&
    canUseUnversionedLegacyProviderId(provider.id)
      ? [
          createUnversionedLegacySmartComposerSecretStoreKey(keyParts),
          createUnversionedLegacyAiderSecretStoreKey(keyParts),
        ]
      : []),
  ]
  return {
    current,
    legacy: Array.from(new Set(legacy)).filter(
      (legacyKey) => legacyKey !== current,
    ),
  }
}

export function unversionedProviderSecretKeys(
  provider: LLMProvider,
  field: 'apiKey' | OAuthSecretField,
): readonly string[] {
  const keyParts = {
    providerId: provider.id,
    providerType: provider.type,
    field,
  }
  return [
    createUnversionedLegacySmartComposerSecretStoreKey(keyParts),
    createUnversionedLegacyAiderSecretStoreKey(keyParts),
  ]
}

export async function writeSecret(
  secretStore: SecretStore,
  key: string | readonly string[] | ProviderSecretKeys,
  value: string,
): Promise<boolean> {
  if (isProviderSecretKeys(key)) {
    try {
      await writeRequiredSecret(secretStore, key.current, value)
      return true
    } catch (currentWriteError) {
      let currentValue: string | null
      try {
        currentValue = await secretStore.getSecret(key.current)
      } catch {
        throw currentWriteError
      }

      if (currentValue === value) return true
      if (currentValue !== null) throw currentWriteError

      return writeSecret(secretStore, key.legacy, value)
    }
  }

  const keys: readonly string[] = Array.isArray(key) ? key : [key]
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
  options: { readonly allowLegacyFallback?: boolean } = {},
): Promise<string | null> {
  const allKeys = new Set([
    keys.current,
    ...(options.allowLegacyFallback === true ? keys.legacy : []),
  ])

  for (const key of allKeys) {
    const secret = await readSecret(secretStore, key)
    if (secret === null) {
      continue
    }

    if (
      key !== keys.current &&
      secretStore.getBackendStatus() !== 'memory-only-fallback'
    ) {
      try {
        await writeSecret(secretStore, keys.current, secret)
        await deleteSecrets(secretStore, keys.legacy)
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
  await deleteSecrets(secretStore, [keys.current, ...keys.legacy])
}

async function deleteSecrets(
  secretStore: SecretStore,
  keys: readonly string[],
): Promise<void> {
  let firstError: unknown
  let failed = false

  for (const secretKey of new Set(keys)) {
    try {
      await secretStore.deleteSecret(secretKey)
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }

  if (failed) {
    throw firstError
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
