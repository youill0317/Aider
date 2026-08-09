import { Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'

import { DEFAULT_EMBEDDING_MODELS } from '../../../../constants'
import { useSettings } from '../../../../contexts/settings-context'
import SmartComposerPlugin from '../../../../main'
import { redactSecrets } from '../../../../utils/security/redact-secrets'
import { ConfirmModal } from '../../../modals/ConfirmModal'
import { deleteEmbeddingModel } from '../../destructive-actions'
import { AddEmbeddingModelModal } from '../../modals/AddEmbeddingModelModal'

type EmbeddingModelsSubSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function EmbeddingModelsSubSection({
  app,
  plugin,
}: EmbeddingModelsSubSectionProps) {
  const { settings, setSettings } = useSettings()

  const handleDeleteEmbeddingModel = async (modelId: string) => {
    if (modelId === settings.embeddingModelId) {
      new Notice(
        'Cannot remove model that is currently selected as Embedding Model',
      )
      return
    }

    const message =
      `Are you sure you want to delete embedding model "${modelId}"?\n\n` +
      `This will also delete all embeddings generated using this model from the database.`

    new ConfirmModal(app, {
      title: 'Delete embedding model',
      message: message,
      ctaText: 'Delete',
      onConfirm: async () => {
        await deleteEmbeddingModel({
          modelId,
          plugin,
          setSettings,
          onCleanupError: (error) => {
            new Notice(
              'Model was removed, but its cached embeddings could not be cleared',
            )
            console.error(
              'Failed to clear embeddings for removed model',
              redactSecrets(error),
            )
          },
        })
      },
    }).open()
  }

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Embedding models</h2>
      <div className="smtcmp-settings-desc">
        Models used for generating embeddings for RAG
      </div>

      <div className="smtcmp-settings-table-container">
        <table className="smtcmp-settings-table">
          <colgroup>
            <col />
            <col />
            <col />
            <col width={90} />
            <col width={60} />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Provider ID</th>
              <th>Model</th>
              <th>Dimension</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {settings.embeddingModels.map((embeddingModel) => (
              <tr key={embeddingModel.id}>
                <td>{embeddingModel.id}</td>
                <td>{embeddingModel.providerId}</td>
                <td>{embeddingModel.model}</td>
                <td>{embeddingModel.dimension}</td>
                <td>
                  <div className="smtcmp-settings-actions">
                    {!DEFAULT_EMBEDDING_MODELS.some(
                      (v) => v.id === embeddingModel.id,
                    ) && (
                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteEmbeddingModel(embeddingModel.id)
                        }
                        className="clickable-icon"
                        aria-label={`Delete embedding model ${embeddingModel.id}`}
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
              <td colSpan={5}>
                <button
                  type="button"
                  onClick={() => {
                    new AddEmbeddingModelModal(app, plugin).open()
                  }}
                >
                  Add custom model
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
