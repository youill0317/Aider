import { App } from 'obsidian'

import { RECOMMENDED_MODELS_FOR_EMBEDDING } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { findFilesMatchingPatterns } from '../../../utils/glob-utils'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextArea } from '../../common/ObsidianTextArea'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { EmbeddingDbManageModal } from '../modals/EmbeddingDbManageModal'
import { ExcludedFilesModal } from '../modals/ExcludedFilesModal'
import { IncludedFilesModal } from '../modals/IncludedFilesModal'

type RAGSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function RAGSection({ app, plugin }: RAGSectionProps) {
  const { settings, setSettings } = useSettings()

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">RAG</h2>

      <ObsidianSetting
        name="Embedding model"
        desc="Choose the model you want to use for embeddings"
      >
        <ObsidianDropdown
          value={settings.embeddingModelId}
          options={Object.fromEntries(
            settings.embeddingModels.map((embeddingModel) => [
              embeddingModel.id,
              `${embeddingModel.id}${RECOMMENDED_MODELS_FOR_EMBEDDING.includes(embeddingModel.id) ? ' (Recommended)' : ''}`,
            ]),
          )}
          onChange={async (value) => {
            await setSettings((currentSettings) => ({
              ...currentSettings,
              embeddingModelId: value,
            }))
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Include patterns"
        desc="Specify glob patterns to include files in indexing (one per line). Example: use 'notes/**' for all files in the notes folder. Leave empty to include all files. Requires 'Rebuild entire vault index' after changes."
        className="smtcmp-settings-textarea-header"
      >
        <ObsidianButton
          text="Test patterns"
          onClick={async () => {
            const patterns = settings.ragOptions.includePatterns
            const includedFiles = await findFilesMatchingPatterns(
              patterns,
              plugin.app.vault,
            )
            new IncludedFilesModal(app, includedFiles, patterns).open()
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting className="smtcmp-settings-textarea">
        <ObsidianTextArea
          value={settings.ragOptions.includePatterns.join('\n')}
          onChange={async (value: string) => {
            const patterns = value
              .split('\n')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
            await setSettings((currentSettings) => ({
              ...currentSettings,
              ragOptions: {
                ...currentSettings.ragOptions,
                includePatterns: patterns,
              },
            }))
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Exclude patterns"
        desc="Specify glob patterns to exclude files from indexing (one per line). Example: use 'notes/**' for all files in the notes folder. Leave empty to exclude nothing. Requires 'Rebuild entire vault index' after changes."
        className="smtcmp-settings-textarea-header"
      >
        <ObsidianButton
          text="Test patterns"
          onClick={async () => {
            const patterns = settings.ragOptions.excludePatterns
            const excludedFiles = await findFilesMatchingPatterns(
              patterns,
              plugin.app.vault,
            )
            new ExcludedFilesModal(app, excludedFiles).open()
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting className="smtcmp-settings-textarea">
        <ObsidianTextArea
          value={settings.ragOptions.excludePatterns.join('\n')}
          onChange={async (value) => {
            const patterns = value
              .split('\n')
              .map((p) => p.trim())
              .filter((p) => p.length > 0)
            await setSettings((currentSettings) => ({
              ...currentSettings,
              ragOptions: {
                ...currentSettings.ragOptions,
                excludePatterns: patterns,
              },
            }))
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Chunk size"
        desc="Set the chunk size for text splitting. After changing this, please re-index the vault using the 'Rebuild entire vault index' command. Accepted range: 400–100,000."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.chunkSize)}
          placeholder="1000"
          type="number"
          min={400}
          max={100_000}
          step={1}
          onChange={async (value) => {
            const chunkSize = Number(value)
            if (
              Number.isInteger(chunkSize) &&
              chunkSize >= 400 &&
              chunkSize <= 100_000
            ) {
              await setSettings((currentSettings) => ({
                ...currentSettings,
                ragOptions: {
                  ...currentSettings.ragOptions,
                  chunkSize,
                },
              }))
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Threshold tokens"
        desc="Maximum number of tokens before switching to RAG. If the total tokens from mentioned files exceed this, RAG will be used instead of including all file contents. Accepted range: 0–10,000,000."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.thresholdTokens)}
          placeholder="8192"
          type="number"
          min={0}
          max={10_000_000}
          step={1}
          onChange={async (value) => {
            if (value.trim() === '') return
            const thresholdTokens = Number(value)
            if (
              Number.isInteger(thresholdTokens) &&
              thresholdTokens >= 0 &&
              thresholdTokens <= 10_000_000
            ) {
              await setSettings((currentSettings) => ({
                ...currentSettings,
                ragOptions: {
                  ...currentSettings.ragOptions,
                  thresholdTokens,
                },
              }))
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Minimum similarity"
        desc="Minimum similarity score for RAG results. Higher values return more relevant but potentially fewer results. Accepted range: -1 to 1."
      >
        {/* Stays type="text": a native number input sanitizes partial decimals
            like "0." to "", which fights the debounced draft state. */}
        <ObsidianTextInput
          value={String(settings.ragOptions.minSimilarity)}
          placeholder="0.0"
          onChange={async (value) => {
            if (!/^-?(?:\d+\.?\d*|\.\d*)?$/.test(value)) return

            if (['', '-', '.', '-.'].includes(value) || value.endsWith('.'))
              return

            const minSimilarity = parseFloat(value)
            if (
              !isNaN(minSimilarity) &&
              minSimilarity >= -1 &&
              minSimilarity <= 1
            ) {
              await setSettings((currentSettings) => ({
                ...currentSettings,
                ragOptions: {
                  ...currentSettings.ragOptions,
                  minSimilarity,
                },
              }))
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Limit"
        desc="Maximum number of RAG results to include in the prompt. Higher values provide more context but increase token usage. Accepted range: 1–100."
      >
        <ObsidianTextInput
          value={String(settings.ragOptions.limit)}
          placeholder="10"
          type="number"
          min={1}
          max={100}
          step={1}
          onChange={async (value) => {
            const limit = Number(value)
            if (Number.isInteger(limit) && limit >= 1 && limit <= 100) {
              await setSettings((currentSettings) => ({
                ...currentSettings,
                ragOptions: {
                  ...currentSettings.ragOptions,
                  limit,
                },
              }))
            }
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Manage embedding database"
        desc="Inspect the embedding database and delete stored indexes by model."
      >
        <ObsidianButton
          text="Manage"
          onClick={async () => {
            new EmbeddingDbManageModal(app, plugin).open()
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
