import { Settings, Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'

import {
  DEFAULT_PROVIDERS,
  PLAN_PROVIDER_TYPES,
  PROVIDER_TYPES_INFO,
} from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { LLMProvider } from '../../../types/provider.types'
import { ConfirmModal } from '../../modals/ConfirmModal'
import {
  AddProviderModal,
  EditProviderModal,
} from '../modals/ProviderFormModal'

type ProvidersSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function ProvidersSection({ app, plugin }: ProvidersSectionProps) {
  const { settings, setSettings } = useSettings()
  const apiProviders = settings.providers.filter(
    (p) => !PLAN_PROVIDER_TYPES.includes(p.type),
  )

  const handleDeleteProvider = async (provider: LLMProvider) => {
    // Get associated models
    const associatedChatModels = settings.chatModels.filter(
      (m) => m.providerId === provider.id,
    )
    const associatedEmbeddingModels = settings.embeddingModels.filter(
      (m) => m.providerId === provider.id,
    )

    const message =
      `Are you sure you want to delete provider "${provider.id}"?\n\n` +
      `This will also delete:\n` +
      `- ${associatedChatModels.length} chat model(s)\n` +
      `- ${associatedEmbeddingModels.length} embedding model(s)\n\n` +
      `All embeddings generated using the associated embedding models will also be deleted.`

    new ConfirmModal(app, {
      title: 'Delete Provider',
      message: message,
      ctaText: 'Delete',
      onConfirm: async () => {
        const chatModels = settings.chatModels.filter(
          (model) => model.providerId !== provider.id,
        )
        const enabledChatModels = chatModels.filter(
          (model) => model.enable !== false,
        )
        const embeddingModels = settings.embeddingModels.filter(
          (model) => model.providerId !== provider.id,
        )
        const fallbackChatModel = enabledChatModels[0]
        const fallbackEmbeddingModel = embeddingModels[0]
        if (!fallbackChatModel || !fallbackEmbeddingModel) {
          new Notice('Cannot delete the last available model provider')
          return
        }

        const vectorManager = (await plugin.getDbManager()).getVectorManager()
        const embeddingStats = await vectorManager.getEmbeddingStats()

        // Clear embeddings for each associated embedding model
        for (const embeddingModel of associatedEmbeddingModels) {
          const embeddingStat = embeddingStats.find(
            (v) => v.model === embeddingModel.id,
          )

          if (embeddingStat?.rowCount && embeddingStat.rowCount > 0) {
            // only clear when there's data
            await vectorManager.clearAllVectors(embeddingModel.id)
          }
        }

        await setSettings({
          ...settings,
          providers: [...settings.providers].filter(
            (v) => v.id !== provider.id,
          ),
          chatModels,
          embeddingModels,
          chatModelId: enabledChatModels.some(
            ({ id }) => id === settings.chatModelId,
          )
            ? settings.chatModelId
            : fallbackChatModel.id,
          applyModelId: enabledChatModels.some(
            ({ id }) => id === settings.applyModelId,
          )
            ? settings.applyModelId
            : fallbackChatModel.id,
          embeddingModelId: embeddingModels.some(
            ({ id }) => id === settings.embeddingModelId,
          )
            ? settings.embeddingModelId
            : fallbackEmbeddingModel.id,
        })
        await plugin.revokeProviderRouteTrust(provider)
      },
    }).open()
  }

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Providers</div>

      <div className="smtcmp-settings-desc">
        <span>Configure API providers (usage-based billing).</span>
        <br />
        <a
          href="https://github.com/youill0317/Aider/wiki/Initial-Setup#getting-your-api-key"
          target="_blank"
          rel="noopener noreferrer"
        >
          How to obtain API keys
        </a>
      </div>

      <div className="smtcmp-settings-table-container">
        <table className="smtcmp-settings-table">
          <colgroup>
            <col />
            <col />
            <col />
            <col width={60} />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>API Key</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {apiProviders.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.id}</td>
                <td>{PROVIDER_TYPES_INFO[provider.type].label}</td>
                <td
                  className="smtcmp-settings-table-api-key"
                  onClick={() => {
                    new EditProviderModal(app, plugin, provider).open()
                  }}
                >
                  {provider.apiKey ? '••••••••' : 'Set API key'}
                </td>
                <td>
                  <div className="smtcmp-settings-actions">
                    <button
                      onClick={() => {
                        new EditProviderModal(app, plugin, provider).open()
                      }}
                      className="clickable-icon"
                    >
                      <Settings />
                    </button>
                    {!DEFAULT_PROVIDERS.some((v) => v.id === provider.id) && (
                      <button
                        onClick={() => handleDeleteProvider(provider)}
                        className="clickable-icon"
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <button
                  onClick={() => {
                    new AddProviderModal(app, plugin).open()
                  }}
                >
                  Add custom provider
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
