import { App, Notice } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { PROVIDER_TYPES_INFO } from '../../../constants'
import { getProviderClient } from '../../../core/llm/manager'
import { supportedDimensionsForIndex } from '../../../database/schema'
import SmartComposerPlugin from '../../../main'
import {
  EmbeddingModel,
  embeddingModelSchema,
} from '../../../types/embedding-model.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'
import { ConfirmModal } from '../../modals/ConfirmModal'

type AddEmbeddingModelModalComponentProps = {
  plugin: SmartComposerPlugin
  onClose: () => void
}

export class AddEmbeddingModelModal extends ReactModal<AddEmbeddingModelModalComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app: app,
      Component: AddEmbeddingModelModalComponent,
      props: { plugin },
      options: {
        title: 'Add Custom Embedding Model',
      },
    })
  }
}

function AddEmbeddingModelModalComponent({
  plugin,
  onClose,
}: AddEmbeddingModelModalComponentProps) {
  const embeddingProviders = plugin.settings.providers.filter(
    (provider) => PROVIDER_TYPES_INFO[provider.type].supportEmbedding,
  )
  const [formData, setFormData] = useState<{
    providerId: string
    id: string
    model: string
    outputDimension?: number
  }>(() => ({
    providerId: embeddingProviders[0]?.id ?? '',
    id: '',
    model: '',
    outputDimension: undefined,
  }))
  const [outputDimensionInput, setOutputDimensionInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const mountedRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
    }
  }, [])

  const handleClose = () => {
    mountedRef.current = false
    abortControllerRef.current?.abort()
    onClose()
  }

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    setIsSubmitting(true)
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      if (plugin.settings.embeddingModels.some((p) => p.id === formData.id)) {
        throw new Error(
          'Model with this ID already exists. Try a different ID.',
        )
      }

      const provider = plugin.settings.providers.find(
        (provider) =>
          provider.id === formData.providerId &&
          PROVIDER_TYPES_INFO[provider.type].supportEmbedding,
      )
      if (!provider) {
        throw new Error('Select an embedding-capable provider')
      }

      const providerClient = getProviderClient({
        settings: plugin.settings,
        providerId: formData.providerId,
      })

      const embeddingResult = await providerClient.getEmbedding(
        formData.model,
        'test',
        {
          dimensions: formData.outputDimension,
          signal: abortController.signal,
        },
      )
      if (!mountedRef.current || abortController.signal.aborted) return

      if (!Array.isArray(embeddingResult) || embeddingResult.length === 0) {
        throw new Error('Embedding model returned an invalid result')
      }

      const dimension = embeddingResult.length

      // Validate that the model respected the requested output dimension
      if (
        formData.outputDimension !== undefined &&
        dimension !== formData.outputDimension
      ) {
        throw new Error(
          `Requested output dimension ${formData.outputDimension}, but the model returned ${dimension} dimensions. ` +
            `This model may not support custom output dimensions (Matryoshka Representation Learning). ` +
            `Leave the "Output Dimensions" field empty to use the model's default dimension.`,
        )
      }

      if (!supportedDimensionsForIndex.includes(dimension)) {
        const confirmed = await new Promise<boolean>((resolve) => {
          new ConfirmModal(plugin.app, {
            title: 'Performance Warning',
            message: `This model outputs ${dimension} dimensions, but the optimized dimensions for database indexing are: ${supportedDimensionsForIndex.join(
              ', ',
            )}.\n\nThis may result in slower search performance.\n\nDo you want to continue anyway?`,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          }).open()
        })

        if (!confirmed) {
          return
        }
        if (!mountedRef.current || abortController.signal.aborted) return
      }

      const embeddingModel: EmbeddingModel = {
        ...formData,
        providerType: provider.type,
        dimension,
      }

      const validationResult = embeddingModelSchema.safeParse(embeddingModel)

      if (!validationResult.success) {
        throw new Error(
          validationResult.error.issues.map((v) => v.message).join('\n'),
        )
      }

      if (!mountedRef.current || abortController.signal.aborted) return
      await plugin.setSettings((currentSettings) => {
        if (
          currentSettings.embeddingModels.some(
            (model) => model.id === embeddingModel.id,
          )
        ) {
          throw new Error('Model with this ID already exists')
        }
        return {
          ...currentSettings,
          embeddingModels: [...currentSettings.embeddingModels, embeddingModel],
        }
      })

      handleClose()
    } catch (error) {
      if (
        abortController.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return
      }
      new Notice(
        error instanceof Error ? error.message : 'An unknown error occurred',
      )
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      isSubmittingRef.current = false
      if (mountedRef.current) setIsSubmitting(false)
    }
  }

  return (
    <>
      <ObsidianSetting
        name="ID"
        desc="Choose an ID to identify this model in your settings. This is just for your reference."
        required
      >
        <ObsidianTextInput
          value={formData.id}
          placeholder="my-custom-embedding-model"
          onChange={(value: string) =>
            setFormData((prev) => ({ ...prev, id: value }))
          }
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Provider ID"
        desc={
          embeddingProviders.length === 0
            ? 'Add an embedding-capable provider before creating an embedding model.'
            : undefined
        }
        required
      >
        {embeddingProviders.length > 0 && (
          <ObsidianDropdown
            value={formData.providerId}
            options={Object.fromEntries(
              embeddingProviders.map((provider) => [provider.id, provider.id]),
            )}
            onChange={(value: string) =>
              setFormData((prev) => ({ ...prev, providerId: value }))
            }
          />
        )}
      </ObsidianSetting>

      <ObsidianSetting name="Model Name" required>
        <ObsidianTextInput
          value={formData.model}
          placeholder="Enter the model name"
          onChange={(value: string) =>
            setFormData((prev) => ({ ...prev, model: value }))
          }
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Output Dimensions"
        desc="Optional. Request a specific output dimension from models that support Matryoshka Representation Learning (MRL), such as OpenAI's text-embedding-3-* or Google's gemini-embedding-001. Leave empty to use the model's default dimension."
      >
        <ObsidianTextInput
          value={outputDimensionInput}
          placeholder="e.g., 768"
          onChange={(value: string) => {
            setOutputDimensionInput(value)
            const parsed = parseInt(value, 10)
            setFormData((prev) => ({
              ...prev,
              outputDimension: isNaN(parsed) ? undefined : parsed,
            }))
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting>
        <ObsidianButton
          text={isSubmitting ? 'Adding…' : 'Add'}
          onClick={handleSubmit}
          disabled={embeddingProviders.length === 0 || isSubmitting}
          cta
        />
        <ObsidianButton text="Cancel" onClick={handleClose} />
      </ObsidianSetting>
    </>
  )
}
