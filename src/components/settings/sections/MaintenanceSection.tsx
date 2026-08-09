import { App, Notice } from 'obsidian'

import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { smartComposerSettingsSchema } from '../../../settings/schema/setting.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { resetSettings } from '../destructive-actions'

type MaintenanceSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function MaintenanceSection({ app, plugin }: MaintenanceSectionProps) {
  const { setSettings } = useSettings()

  const handleResetSettings = () => {
    new ConfirmModal(app, {
      title: 'Reset settings',
      message:
        'Are you sure you want to reset all settings to default values? This cannot be undone.',
      ctaText: 'Reset',
      onConfirm: async () => {
        await resetSettings({
          defaultSettings: smartComposerSettingsSchema.parse({}),
          plugin,
          setSettings,
          settings: plugin.settings,
        })
        new Notice('Settings have been reset to defaults')
      },
    }).open()
  }

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">Maintenance</h2>

      <ObsidianSetting
        name="Reset settings"
        desc="Reset all settings to default values"
      >
        <ObsidianButton text="Reset" warning onClick={handleResetSettings} />
      </ObsidianSetting>
    </div>
  )
}
