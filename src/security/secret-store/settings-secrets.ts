import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { McpServerConfig } from '../../types/mcp.types'
import type { LLMProvider } from '../../types/provider.types'

import {
  OAUTH_SECRET_FIELDS,
  deleteProviderSecrets,
  hasOAuth,
  isNonEmptySecret,
  providerSecretKeys,
  readProviderSecret,
  writeSecret,
} from './provider-secret-utils'
import type { SecretStore } from './secret-store'
import { createMcpEnvSecretStoreKey } from './secret-store'

type ProviderSecretKeys = ReturnType<typeof providerSecretKeys>
type SecretSnapshot = {
  values: readonly { key: string; value: string | null }[]
}

function allSecretKeys(keys: ProviderSecretKeys): string[] {
  return Array.from(new Set([keys.current, ...keys.legacy]))
}

async function captureSecretSnapshot(
  secretStore: SecretStore,
  keys: ProviderSecretKeys,
): Promise<SecretSnapshot> {
  return captureKeySnapshot(secretStore, allSecretKeys(keys))
}

async function captureKeySnapshot(
  secretStore: SecretStore,
  keys: readonly string[],
): Promise<SecretSnapshot> {
  return {
    values: await Promise.all(
      [...new Set(keys)].map(async (key) => ({
        key,
        value: await secretStore.getSecret(key),
      })),
    ),
  }
}

async function restoreSecretSnapshots(
  secretStore: SecretStore,
  snapshots: readonly SecretSnapshot[],
): Promise<boolean> {
  let restored = true

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    for (const { key, value } of snapshots[index].values) {
      try {
        if (value === null) {
          await secretStore.deleteSecret(key)
        } else {
          await secretStore.setSecret(key, value)
        }
      } catch {
        restored = false
      }
    }
  }

  return restored
}

async function writeProviderSecret(
  secretStore: SecretStore,
  keys: ProviderSecretKeys,
  value: string,
  snapshots: SecretSnapshot[],
): Promise<void> {
  snapshots.push(await captureSecretSnapshot(secretStore, keys))
  await writeSecret(secretStore, keys, value)
}

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

function parseMcpEnv(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value)
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('Invalid MCP environment secret')
  }
  return parsed as Record<string, string>
}

function serializeMcpEnv(env: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(env).sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

async function hydrateMcpServer(
  server: McpServerConfig,
  secretStore: SecretStore,
): Promise<McpServerConfig> {
  const storedEnv = await secretStore.getSecret(
    createMcpEnvSecretStoreKey(server.id),
  )
  if (storedEnv === null) {
    return server
  }
  return {
    ...server,
    parameters: {
      ...server.parameters,
      env: {
        ...parseMcpEnv(storedEnv),
        ...(server.parameters.env ?? {}),
      },
    },
  }
}

async function sanitizeProvider(
  provider: LLMProvider,
  secretStore: SecretStore,
  snapshots: SecretSnapshot[],
  previousProvider?: LLMProvider,
): Promise<LLMProvider> {
  const sanitizedProvider = { ...provider }

  if (isNonEmptySecret(provider.apiKey)) {
    if (provider.apiKey !== previousProvider?.apiKey) {
      await writeProviderSecret(
        secretStore,
        providerSecretKeys(provider, 'apiKey'),
        provider.apiKey,
        snapshots,
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
      await writeProviderSecret(
        secretStore,
        providerSecretKeys(provider, field),
        provider.oauth[field],
        snapshots,
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
  snapshots?: SecretSnapshot[],
): Promise<void> {
  if (!previousSettings) {
    return
  }

  for (const previousProvider of previousSettings.providers) {
    const nextProvider = nextRuntimeSettings.providers.find(
      (provider) => provider.id === previousProvider.id,
    )

    if (!nextProvider || nextProvider.type !== previousProvider.type) {
      await deleteAllProviderSecrets(previousProvider, secretStore, snapshots)
      continue
    }

    if (hasOAuth(previousProvider) && previousProvider.oauth) {
      if (!hasOAuth(nextProvider) || !nextProvider.oauth) {
        await deleteOAuthSecrets(previousProvider, secretStore, snapshots)
      } else {
        for (const field of OAUTH_SECRET_FIELDS) {
          if (
            isNonEmptySecret(previousProvider.oauth[field]) &&
            !isNonEmptySecret(nextProvider.oauth[field])
          ) {
            await deleteSecretKeys(
              providerSecretKeys(previousProvider, field),
              secretStore,
              snapshots,
            )
          }
        }
      }
    }

    if (
      isNonEmptySecret(previousProvider.apiKey) &&
      !isNonEmptySecret(nextProvider.apiKey)
    ) {
      await deleteSecretKeys(
        providerSecretKeys(previousProvider, 'apiKey'),
        secretStore,
        snapshots,
      )
    }
  }
}

async function deleteAllProviderSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
  snapshots?: SecretSnapshot[],
): Promise<void> {
  await deleteSecretKeys(
    providerSecretKeys(provider, 'apiKey'),
    secretStore,
    snapshots,
  )

  if (hasOAuth(provider)) {
    await deleteOAuthSecrets(provider, secretStore, snapshots)
  }
}

async function deleteOAuthSecrets(
  provider: LLMProvider,
  secretStore: SecretStore,
  snapshots?: SecretSnapshot[],
): Promise<void> {
  for (const field of OAUTH_SECRET_FIELDS) {
    await deleteSecretKeys(
      providerSecretKeys(provider, field),
      secretStore,
      snapshots,
    )
  }
}

async function deleteSecretKeys(
  keys: ProviderSecretKeys,
  secretStore: SecretStore,
  snapshots?: SecretSnapshot[],
): Promise<void> {
  if (snapshots) {
    snapshots.push(await captureSecretSnapshot(secretStore, keys))
  }
  await deleteProviderSecrets(secretStore, keys)
}

async function writeMcpEnvSecret(
  secretStore: SecretStore,
  serverId: string,
  value: string,
  snapshots: SecretSnapshot[],
): Promise<void> {
  const key = createMcpEnvSecretStoreKey(serverId)
  snapshots.push(await captureKeySnapshot(secretStore, [key]))
  await secretStore.setSecret(key, value)
}

async function deleteMcpEnvSecret(
  secretStore: SecretStore,
  serverId: string,
  snapshots: SecretSnapshot[],
): Promise<void> {
  const key = createMcpEnvSecretStoreKey(serverId)
  snapshots.push(await captureKeySnapshot(secretStore, [key]))
  await secretStore.deleteSecret(key)
}

export async function hydrateSettingsSecrets(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
): Promise<SmartComposerSettings> {
  const [providers, servers] = await Promise.all([
    Promise.all(
      settings.providers.map((provider) =>
        hydrateProvider(provider, secretStore),
      ),
    ),
    Promise.all(
      settings.mcp.servers.map((server) =>
        hydrateMcpServer(server, secretStore),
      ),
    ),
  ])

  return {
    ...settings,
    providers,
    mcp: { ...settings.mcp, servers },
  }
}

export async function sanitizeSettingsForPersistence(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
  previousSettings?: SmartComposerSettings,
): Promise<SmartComposerSettings> {
  const snapshots: SecretSnapshot[] = []

  try {
    let sanitizedSettings = await sanitizeSettingsProviders(
      settings,
      secretStore,
      snapshots,
      previousSettings,
    )
    sanitizedSettings = await sanitizeSettingsMcp(
      sanitizedSettings,
      secretStore,
      snapshots,
      previousSettings,
    )
    await deleteRemovedProviderSecrets(
      previousSettings,
      settings,
      secretStore,
      snapshots,
    )
    await deleteRemovedMcpSecrets(
      previousSettings,
      settings,
      secretStore,
      snapshots,
    )
    return sanitizedSettings
  } catch (error) {
    if (!(await restoreSecretSnapshots(secretStore, snapshots))) {
      throw new Error(
        'Settings update failed and previous secrets could not be restored',
      )
    }
    throw error
  }
}

async function sanitizeSettingsProviders(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
  snapshots: SecretSnapshot[],
  previousSettings?: SmartComposerSettings,
): Promise<SmartComposerSettings> {
  const providers: LLMProvider[] = []

  for (const provider of settings.providers) {
    const previousProvider = previousSettings?.providers.find(
      (candidate) =>
        candidate.id === provider.id && candidate.type === provider.type,
    )
    providers.push(
      await sanitizeProvider(
        provider,
        secretStore,
        snapshots,
        previousProvider,
      ),
    )
  }

  return {
    ...settings,
    providers,
  }
}

async function sanitizeSettingsMcp(
  settings: SmartComposerSettings,
  secretStore: SecretStore,
  snapshots: SecretSnapshot[],
  previousSettings?: SmartComposerSettings,
): Promise<SmartComposerSettings> {
  const servers: McpServerConfig[] = []

  for (const server of settings.mcp.servers) {
    const env = server.parameters.env ?? {}
    const value = serializeMcpEnv(env)
    const key = createMcpEnvSecretStoreKey(server.id)
    const storedValue = await secretStore.getSecret(key)
    if (Object.keys(env).length > 0 && storedValue !== value) {
      await writeMcpEnvSecret(secretStore, server.id, value, snapshots)
    } else if (
      Object.keys(env).length === 0 &&
      previousSettings?.mcp.servers.some(
        (previous) =>
          previous.id === server.id &&
          Object.keys(previous.parameters.env ?? {}).length > 0,
      )
    ) {
      await deleteMcpEnvSecret(secretStore, server.id, snapshots)
    }

    const parameters = { ...server.parameters }
    delete parameters.env
    servers.push({ ...server, parameters })
  }

  return { ...settings, mcp: { ...settings.mcp, servers } }
}

async function deleteRemovedMcpSecrets(
  previousSettings: SmartComposerSettings | undefined,
  nextSettings: SmartComposerSettings,
  secretStore: SecretStore,
  snapshots: SecretSnapshot[],
): Promise<void> {
  if (!previousSettings) return

  for (const server of previousSettings.mcp.servers) {
    if (
      !nextSettings.mcp.servers.some((candidate) => candidate.id === server.id)
    ) {
      await deleteMcpEnvSecret(secretStore, server.id, snapshots)
    }
  }
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
  const snapshots: SecretSnapshot[] = []

  try {
    let persistedSettings = await sanitizeSettingsProviders(
      nextSettings,
      secretStore,
      snapshots,
      previousSettings,
    )
    persistedSettings = await sanitizeSettingsMcp(
      persistedSettings,
      secretStore,
      snapshots,
      previousSettings,
    )
    await deleteRemovedProviderSecrets(
      previousSettings,
      nextSettings,
      secretStore,
      snapshots,
    )
    await deleteRemovedMcpSecrets(
      previousSettings,
      nextSettings,
      secretStore,
      snapshots,
    )
    await saveData(persistedSettings)
  } catch (error) {
    const restored = await restoreSecretSnapshots(secretStore, snapshots)
    publishRuntimeSettings(previousSettings)
    if (!restored) {
      throw new Error(
        'Settings update failed and previous secrets could not be restored',
      )
    }
    throw error
  }
}
