import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { LLMProvider } from '../../types/provider.types'

/**
 * Destructive settings actions, kept out of the section components so their
 * step order is testable.
 *
 * The order is the whole point of these helpers:
 *
 *   1. Revoke trust before persisting a removal. A crash between the two must
 *      leave a revoked grant for a still-listed server, never a live grant for
 *      a server the user believes is gone.
 *   2. Persist settings before deleting vectors. Embeddings are rebuildable;
 *      settings are not. If the settings write fails, the vectors must survive
 *      so the still-configured model keeps working.
 *
 * Every step here awaits the previous one, so a rejection stops the sequence
 * instead of running the destructive half on its own.
 */

type SettingsUpdater = (
  update: (current: SmartComposerSettings) => SmartComposerSettings,
) => void | Promise<void>

type VectorManager = {
  clearAllVectors: (modelId: string) => Promise<void>
  clearAllVectorsForModels: (modelIds: string[]) => Promise<void>
  getEmbeddingStats: () => Promise<{ model: string; rowCount: number }[]>
}

type DestructivePlugin = {
  getDbManager: () => Promise<{ getVectorManager: () => VectorManager }>
  revokeMcpServerTrust: (serverId: string) => Promise<void>
  revokeProviderRouteTrust: (provider: LLMProvider) => Promise<void>
}

/**
 * Clearing embeddings is best-effort cleanup after the removal is already
 * durable, so a failure here is reported but does not undo the removal.
 */
async function clearVectorsBestEffort(
  plugin: Pick<DestructivePlugin, 'getDbManager'>,
  clear: (vectorManager: VectorManager) => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    const vectorManager = (await plugin.getDbManager()).getVectorManager()
    await clear(vectorManager)
  } catch (error) {
    onError(error)
  }
}

export async function deleteProvider({
  onCleanupError,
  plugin,
  provider,
  setSettings,
}: {
  onCleanupError: (error: unknown) => void
  plugin: Pick<DestructivePlugin, 'getDbManager' | 'revokeProviderRouteTrust'>
  provider: LLMProvider
  setSettings: SettingsUpdater
}): Promise<void> {
  let removedEmbeddingModelIds: string[] = []

  await plugin.revokeProviderRouteTrust(provider)
  await setSettings((currentSettings) => {
    const currentChatModels = currentSettings.chatModels.filter(
      (model) => model.providerId !== provider.id,
    )
    const currentEnabledChatModels = currentChatModels.filter(
      (model) => model.enable !== false,
    )
    const currentEmbeddingModels = currentSettings.embeddingModels.filter(
      (model) => model.providerId !== provider.id,
    )
    const currentFallbackChatModel = currentEnabledChatModels[0]
    const currentFallbackEmbeddingModel = currentEmbeddingModels[0]
    if (!currentFallbackChatModel || !currentFallbackEmbeddingModel) {
      throw new Error('Cannot delete the last available model provider')
    }
    removedEmbeddingModelIds = currentSettings.embeddingModels
      .filter((model) => model.providerId === provider.id)
      .map((model) => model.id)
    return {
      ...currentSettings,
      providers: currentSettings.providers.filter(
        (value) => value.id !== provider.id,
      ),
      chatModels: currentChatModels,
      embeddingModels: currentEmbeddingModels,
      chatModelId: currentEnabledChatModels.some(
        ({ id }) => id === currentSettings.chatModelId,
      )
        ? currentSettings.chatModelId
        : currentFallbackChatModel.id,
      applyModelId: currentEnabledChatModels.some(
        ({ id }) => id === currentSettings.applyModelId,
      )
        ? currentSettings.applyModelId
        : currentFallbackChatModel.id,
      embeddingModelId: currentEmbeddingModels.some(
        ({ id }) => id === currentSettings.embeddingModelId,
      )
        ? currentSettings.embeddingModelId
        : currentFallbackEmbeddingModel.id,
    }
  })

  await clearVectorsBestEffort(
    plugin,
    async (vectorManager) => {
      const embeddingStats = await vectorManager.getEmbeddingStats()
      const modelsWithData = removedEmbeddingModelIds.filter((modelId) =>
        embeddingStats.some(
          (stat) => stat.model === modelId && stat.rowCount > 0,
        ),
      )
      await vectorManager.clearAllVectorsForModels(modelsWithData)
    },
    onCleanupError,
  )
}

export async function deleteEmbeddingModel({
  modelId,
  onCleanupError,
  plugin,
  setSettings,
}: {
  modelId: string
  onCleanupError: (error: unknown) => void
  plugin: Pick<DestructivePlugin, 'getDbManager'>
  setSettings: SettingsUpdater
}): Promise<void> {
  await setSettings((currentSettings) => {
    if (modelId === currentSettings.embeddingModelId) {
      throw new Error('Cannot remove a model that is currently selected')
    }
    return {
      ...currentSettings,
      embeddingModels: currentSettings.embeddingModels.filter(
        (value) => value.id !== modelId,
      ),
    }
  })

  await clearVectorsBestEffort(
    plugin,
    async (vectorManager) => {
      const embeddingStats = await vectorManager.getEmbeddingStats()
      const embeddingStat = embeddingStats.find(
        (value) => value.model === modelId,
      )
      if (embeddingStat?.rowCount && embeddingStat.rowCount > 0) {
        await vectorManager.clearAllVectors(modelId)
      }
    },
    onCleanupError,
  )
}

export async function deleteMcpServer({
  plugin,
  serverId,
  setSettings,
}: {
  plugin: Pick<DestructivePlugin, 'revokeMcpServerTrust'>
  serverId: string
  setSettings: SettingsUpdater
}): Promise<void> {
  await plugin.revokeMcpServerTrust(serverId)
  await setSettings((currentSettings) => ({
    ...currentSettings,
    mcp: {
      ...currentSettings.mcp,
      servers: currentSettings.mcp.servers.filter((s) => s.id !== serverId),
    },
  }))
}

export async function resetSettings({
  defaultSettings,
  plugin,
  setSettings,
  settings,
}: {
  defaultSettings: SmartComposerSettings
  plugin: Pick<
    DestructivePlugin,
    'revokeMcpServerTrust' | 'revokeProviderRouteTrust'
  >
  setSettings: SettingsUpdater
  settings: SmartComposerSettings
}): Promise<void> {
  await Promise.all([
    ...settings.providers.map((provider) =>
      plugin.revokeProviderRouteTrust(provider),
    ),
    ...settings.mcp.servers.map((server) =>
      plugin.revokeMcpServerTrust(server.id),
    ),
  ])
  await setSettings(() => defaultSettings)
}
