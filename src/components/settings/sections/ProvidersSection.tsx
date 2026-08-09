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
import { redactSecrets } from '../../../utils/security/redact-secrets'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { deleteProvider } from '../destructive-actions'
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
      title: 'Delete provider',
      message: message,
      ctaText: 'Delete',
      onConfirm: async () => {
        await deleteProvider({
          plugin,
          provider,
          setSettings,
          onCleanupError: (error) => {
            new Notice(
              'Provider was removed, but its cached embeddings could not be cleared',
            )
            console.error(
              'Failed to clear embeddings for removed provider',
              redactSecrets(error),
            )
          },
        })
      },
    }).open()
  }

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Providers</h2>

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
              <th>API key</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {apiProviders.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.id}</td>
                <td>{PROVIDER_TYPES_INFO[provider.type].label}</td>
                <td>
                  <button
                    type="button"
                    className="smtcmp-settings-table-api-key"
                    aria-label={`Edit API key for ${provider.id}`}
                    onClick={() => {
                      new EditProviderModal(app, plugin, provider).open()
                    }}
                  >
                    {provider.apiKey ? '••••••••' : 'Set API key'}
                  </button>
                </td>
                <td>
                  <div className="smtcmp-settings-actions">
                    <button
                      type="button"
                      onClick={() => {
                        new EditProviderModal(app, plugin, provider).open()
                      }}
                      className="clickable-icon"
                      aria-label={`Edit provider ${provider.id}`}
                    >
                      <Settings />
                    </button>
                    {!DEFAULT_PROVIDERS.some((v) => v.id === provider.id) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProvider(provider)}
                        className="clickable-icon"
                        aria-label={`Delete provider ${provider.id}`}
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
                  type="button"
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
