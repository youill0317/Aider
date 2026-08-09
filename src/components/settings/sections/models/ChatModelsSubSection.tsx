import { Settings, Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'
import { ObsidianToggle } from 'src/components/common/ObsidianToggle'

import { DEFAULT_CHAT_MODELS } from '../../../../constants'
import { useSettings } from '../../../../contexts/settings-context'
import SmartComposerPlugin from '../../../../main'
import { ConfirmModal } from '../../../modals/ConfirmModal'
import { AddChatModelModal } from '../../modals/AddChatModelModal'

import {
  ChatModelSettingsModal,
  hasChatModelSettings,
} from './ChatModelSettings'

type ChatModelsSubSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

const isEnabled = (enable: boolean | undefined | null) => enable ?? true

export function ChatModelsSubSection({
  app,
  plugin,
}: ChatModelsSubSectionProps) {
  const { settings, setSettings } = useSettings()

  const handleDeleteChatModel = async (modelId: string) => {
    if (modelId === settings.chatModelId || modelId === settings.applyModelId) {
      new Notice(
        'Cannot remove model that is currently selected as Chat Model or Apply Model',
      )
      return
    }

    const message = `Are you sure you want to delete model "${modelId}"?`
    new ConfirmModal(app, {
      title: 'Delete chat model',
      message: message,
      ctaText: 'Delete',
      onConfirm: async () => {
        await setSettings((currentSettings) => {
          if (
            modelId === currentSettings.chatModelId ||
            modelId === currentSettings.applyModelId
          ) {
            throw new Error('Cannot remove a model that is currently selected')
          }
          return {
            ...currentSettings,
            chatModels: currentSettings.chatModels.filter(
              (v) => v.id !== modelId,
            ),
          }
        })
      },
    }).open()
  }

  const handleToggleEnableChatModel = async (
    modelId: string,
    value: boolean,
  ) => {
    if (
      !value &&
      (modelId === settings.chatModelId || modelId === settings.applyModelId)
    ) {
      new Notice(
        'Cannot disable model that is currently selected as Chat Model or Apply Model',
      )

      // to trigger re-render
      await setSettings((currentSettings) => ({
        ...currentSettings,
        chatModels: currentSettings.chatModels.map((v) =>
          v.id === modelId ? { ...v, enable: true } : v,
        ),
      }))
      return
    }

    await setSettings((currentSettings) => ({
      ...currentSettings,
      chatModels: currentSettings.chatModels.map((v) =>
        v.id === modelId ? { ...v, enable: value } : v,
      ),
    }))
  }

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Chat models</h2>
      <div className="smtcmp-settings-desc">Models used for chat and apply</div>

      <div className="smtcmp-settings-table-container">
        <table className="smtcmp-settings-table">
          <colgroup>
            <col />
            <col />
            <col />
            <col width={60} />
            <col width={60} />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Provider ID</th>
              <th>Model</th>
              <th>Enable</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {settings.chatModels.map((chatModel) => (
              <tr key={chatModel.id}>
                <td>{chatModel.id}</td>
                <td>{chatModel.providerId}</td>
                <td>{chatModel.model}</td>
                <td>
                  <ObsidianToggle
                    ariaLabel={`Enable chat model ${chatModel.id}`}
                    value={isEnabled(chatModel.enable)}
                    onChange={(value) =>
                      handleToggleEnableChatModel(chatModel.id, value)
                    }
                  />
                </td>
                <td>
                  <div className="smtcmp-settings-actions">
                    {hasChatModelSettings(chatModel) && (
                      <button
                        type="button"
                        onClick={() => {
                          new ChatModelSettingsModal(
                            chatModel,
                            app,
                            plugin,
                          ).open()
                        }}
                        className="clickable-icon"
                        aria-label={`Configure chat model ${chatModel.id}`}
                      >
                        <Settings />
                      </button>
                    )}
                    {!DEFAULT_CHAT_MODELS.some(
                      (v) => v.id === chatModel.id,
                    ) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteChatModel(chatModel.id)}
                        className="clickable-icon"
                        aria-label={`Delete chat model ${chatModel.id}`}
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
                    new AddChatModelModal(app, plugin).open()
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
