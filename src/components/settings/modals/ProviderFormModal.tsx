import { App, Notice } from 'obsidian'
import { useState } from 'react'

import { PLAN_PROVIDER_TYPES, PROVIDER_TYPES_INFO } from '../../../constants'
import SmartComposerPlugin from '../../../main'
import {
  LLMProvider,
  LLMProviderType,
  llmProviderSchema,
} from '../../../types/provider.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ReactModal } from '../../common/ReactModal'

type ProviderFormComponentProps = {
  plugin: SmartComposerPlugin
  provider: LLMProvider | null // null for new provider
  onClose: () => void
}

export class AddProviderModal extends ReactModal<ProviderFormComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app: app,
      Component: ProviderFormComponent,
      props: { plugin, provider: null },
      options: {
        title: 'Add Custom Provider',
      },
    })
  }
}

export class EditProviderModal extends ReactModal<ProviderFormComponentProps> {
  constructor(app: App, plugin: SmartComposerPlugin, provider: LLMProvider) {
    super({
      app: app,
      Component: ProviderFormComponent,
      props: { plugin, provider },
      options: {
        title: `Edit Provider: ${provider.id}`,
      },
    })
  }
}

function ProviderFormComponent({
  plugin,
  provider,
  onClose,
}: ProviderFormComponentProps) {
  const [formData, setFormData] = useState<LLMProvider>(
    provider
      ? { ...provider }
      : {
          type: 'openai-compatible',
          id: '',
          apiKey: '',
          baseUrl: '',
        },
  )

  const handleSubmit = async () => {
    if (provider) {
      if (
        !plugin.settings.providers.some((value) => value.id === provider.id)
      ) {
        new Notice(`No provider found with this ID`)
        return
      }

      const validationResult = llmProviderSchema.safeParse(formData)
      if (!validationResult.success) {
        new Notice(
          validationResult.error.issues.map((v) => v.message).join('\n'),
        )
        return
      }

      await plugin.setTrustedProviderSettings(
        formData,
        (currentSettings) => {
          const currentProviderIndex = currentSettings.providers.findIndex(
            (value) => value.id === provider.id,
          )
          if (currentProviderIndex === -1) {
            throw new Error('Provider no longer exists')
          }
          if (
            formData.id !== provider.id &&
            currentSettings.providers.some((value) => value.id === formData.id)
          ) {
            throw new Error('Provider with this ID already exists')
          }
          return {
            ...currentSettings,
            providers: currentSettings.providers.map((value, index) =>
              index === currentProviderIndex ? formData : value,
            ),
          }
        },
        provider,
      )
    } else {
      if (
        plugin.settings.providers.some((p: LLMProvider) => p.id === formData.id)
      ) {
        new Notice('Provider with this ID already exists. Try a different ID.')
        return
      }

      const validationResult = llmProviderSchema.safeParse(formData)
      if (!validationResult.success) {
        new Notice(
          validationResult.error.issues.map((v) => v.message).join('\n'),
        )
        return
      }

      await plugin.setTrustedProviderSettings(formData, (currentSettings) => {
        if (
          currentSettings.providers.some((value) => value.id === formData.id)
        ) {
          throw new Error('Provider with this ID already exists')
        }
        return {
          ...currentSettings,
          providers: [...currentSettings.providers, formData],
        }
      })
    }

    onClose()
  }

  const providerTypeInfo = PROVIDER_TYPES_INFO[formData.type]

  return (
    <>
      {!provider && (
        <>
          <ObsidianSetting
            name="ID"
            desc="Choose an ID to identify this provider in your settings. This is just for your reference."
            required
          >
            <ObsidianTextInput
              value={formData.id}
              placeholder="my-custom-provider"
              onChange={(value: string) =>
                setFormData((prev) => ({ ...prev, id: value }))
              }
            />
          </ObsidianSetting>

          <ObsidianSetting name="Provider Type" required>
            <ObsidianDropdown
              value={formData.type}
              options={Object.fromEntries(
                Object.entries(PROVIDER_TYPES_INFO)
                  .filter(
                    ([key]) =>
                      !PLAN_PROVIDER_TYPES.includes(key as LLMProviderType),
                  )
                  .map(([key, info]) => [key, info.label]),
              )}
              onChange={(value: string) =>
                setFormData(
                  (prev) =>
                    ({
                      ...prev,
                      type: value,
                      additionalSettings: {},
                    }) as LLMProvider,
                )
              }
            />
          </ObsidianSetting>
        </>
      )}

      {!PLAN_PROVIDER_TYPES.includes(formData.type) && (
        <>
          <ObsidianSetting
            name="API Key"
            desc="(leave blank if not required)"
            required={providerTypeInfo.requireApiKey}
          >
            <ObsidianTextInput
              value={formData.apiKey ?? ''}
              placeholder="Enter your API Key"
              onChange={(value: string) =>
                setFormData((prev) => ({ ...prev, apiKey: value }))
              }
            />
          </ObsidianSetting>

          <ObsidianSetting
            name="Base URL"
            desc="Leave blank for the official default. Saving records trust for this exact custom endpoint on this device."
            required={providerTypeInfo.requireBaseUrl}
          >
            <ObsidianTextInput
              value={formData.baseUrl ?? ''}
              placeholder="Enter base URL"
              onChange={(value: string) =>
                setFormData((prev) => ({ ...prev, baseUrl: value }))
              }
            />
          </ObsidianSetting>
        </>
      )}

      {providerTypeInfo.additionalSettings.map((setting) => (
        <ObsidianSetting
          key={setting.key}
          name={setting.label}
          desc={'description' in setting ? setting.description : undefined}
          required={setting.required}
        >
          {setting.type === 'toggle' ? (
            <ObsidianToggle
              value={
                (formData.additionalSettings as Record<string, boolean>)?.[
                  setting.key
                ] ?? false
              }
              onChange={(value: boolean) =>
                setFormData(
                  (prev) =>
                    ({
                      ...prev,
                      additionalSettings: {
                        ...(prev.additionalSettings ?? {}),
                        [setting.key]: value,
                      },
                    }) as LLMProvider,
                )
              }
            />
          ) : (
            <ObsidianTextInput
              value={
                (formData.additionalSettings as Record<string, string>)?.[
                  setting.key
                ] ?? ''
              }
              placeholder={setting.placeholder}
              onChange={(value: string) =>
                setFormData(
                  (prev) =>
                    ({
                      ...prev,
                      additionalSettings: {
                        ...(prev.additionalSettings ?? {}),
                        [setting.key]: value,
                      },
                    }) as LLMProvider,
                )
              }
            />
          )}
        </ObsidianSetting>
      ))}

      <ObsidianSetting>
        <ObsidianButton
          text={provider ? 'Save' : 'Add'}
          onClick={handleSubmit}
          cta
        />
        <ObsidianButton text="Cancel" onClick={onClose} />
      </ObsidianSetting>
    </>
  )
}
