import type { McpServerConfig } from '../types/mcp.types'
import type { LLMProvider } from '../types/provider.types'

import type { SecretStore } from './secret-store/secret-store'
import {
  createMcpExecutionTrustKey,
  createProviderRouteTrustKey,
} from './secret-store/secret-store'

const trustedProviderRoutes = new Map<string, string>()

export async function isMcpServerTrusted(
  config: McpServerConfig,
  secretStore: SecretStore,
): Promise<boolean> {
  return hasMatchingFingerprint(
    secretStore,
    createMcpExecutionTrustKey(config.id),
    canonicalMcpConfig(config),
  )
}

export async function trustMcpServer(
  config: McpServerConfig,
  secretStore: SecretStore,
): Promise<void> {
  await secretStore.setSecret(
    createMcpExecutionTrustKey(config.id),
    await fingerprint(canonicalMcpConfig(config)),
  )
}

export async function revokeMcpServerTrust(
  serverId: string,
  secretStore: SecretStore,
): Promise<void> {
  await secretStore.deleteSecret(createMcpExecutionTrustKey(serverId))
}

export async function loadProviderRouteTrust(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<boolean> {
  const canonical = canonicalProviderRoute(provider)
  const trustKey = createProviderRouteTrustKey(provider.id, provider.type)
  if (isDefaultProviderRoute(provider)) {
    trustedProviderRoutes.delete(trustKey)
    return true
  }
  const trusted = await isProviderRouteExplicitlyTrusted(provider, secretStore)
  if (trusted) trustedProviderRoutes.set(trustKey, canonical)
  else trustedProviderRoutes.delete(trustKey)
  return trusted
}

export async function isProviderRouteExplicitlyTrusted(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<boolean> {
  return hasMatchingFingerprint(
    secretStore,
    createProviderRouteTrustKey(provider.id, provider.type),
    canonicalProviderRoute(provider),
  )
}

export async function trustProviderRoute(
  provider: LLMProvider,
  secretStore: SecretStore,
): Promise<void> {
  const canonical = canonicalProviderRoute(provider)
  const trustKey = createProviderRouteTrustKey(provider.id, provider.type)
  await secretStore.setSecret(trustKey, await fingerprint(canonical))
  trustedProviderRoutes.set(trustKey, canonical)
}

export async function revokeProviderRouteTrust(
  provider: Pick<LLMProvider, 'id' | 'type'>,
  secretStore: SecretStore,
): Promise<void> {
  const trustKey = createProviderRouteTrustKey(provider.id, provider.type)
  trustedProviderRoutes.delete(trustKey)
  await secretStore.deleteSecret(trustKey)
}

export function assertProviderRouteTrusted(provider: LLMProvider): void {
  if (
    !isDefaultProviderRoute(provider) &&
    trustedProviderRoutes.get(
      createProviderRouteTrustKey(provider.id, provider.type),
    ) !== canonicalProviderRoute(provider)
  ) {
    throw new Error(
      `Provider ${provider.id} endpoint requires review in Aider settings`,
    )
  }
}

export function providerRoutesMatch(
  left: LLMProvider,
  right: LLMProvider,
): boolean {
  return canonicalProviderRoute(left) === canonicalProviderRoute(right)
}

async function hasMatchingFingerprint(
  secretStore: SecretStore,
  key: string,
  canonical: string,
): Promise<boolean> {
  try {
    const stored = await secretStore.getSecret(key)
    return stored !== null && stored === (await fingerprint(canonical))
  } catch {
    return false
  }
}

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function canonicalMcpConfig(config: McpServerConfig): string {
  return JSON.stringify({
    v: 1,
    id: config.id,
    command: config.parameters.command,
    args: config.parameters.args ?? [],
    env: Object.entries(config.parameters.env ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  })
}

function canonicalProviderRoute(provider: LLMProvider): string {
  return JSON.stringify({
    v: 1,
    id: provider.id,
    type: provider.type,
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    additionalSettings: sortRecord(provider.additionalSettings),
  })
}

function isDefaultProviderRoute(provider: LLMProvider): boolean {
  return (
    normalizeBaseUrl(provider.baseUrl) === '' &&
    provider.type !== 'openai-compatible' &&
    provider.type !== 'azure-openai'
  )
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord)
  if (value === null || typeof value !== 'object') return value ?? null
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortRecord(nested)]),
  )
}
