import { useSettings } from '../../../contexts/settings-context'
import type {
  CodexApprovalPolicy,
  CodexSandboxMode,
} from '../../../core/agent/types'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'

const SANDBOX_OPTIONS: Record<CodexSandboxMode, string> = {
  'danger-full-access': 'Full access',
  'read-only': 'Read only',
  'workspace-write': 'Workspace write',
}

const APPROVAL_OPTIONS: Record<CodexApprovalPolicy, string> = {
  default: 'Default',
  never: 'Never',
  'on-request': 'Ask me',
  untrusted: 'Untrusted',
}

export function CodexToolSection() {
  const { settings, setSettings } = useSettings()
  const codexSettings = settings.agent.codex

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Codex tool</div>

      <ObsidianSetting
        name="Enable Codex tool"
        desc="Allow Smart Composer chat to ask before running Codex CLI tasks."
      >
        <ObsidianToggle
          value={codexSettings.enabled}
          onChange={async (enabled) => {
            await setSettings({
              ...settings,
              agent: {
                ...settings.agent,
                codex: {
                  ...codexSettings,
                  enabled,
                },
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Codex command"
        desc="Command used for approved Codex tool executions."
      >
        <ObsidianTextInput
          value={codexSettings.command}
          onChange={async (command) => {
            await setSettings({
              ...settings,
              agent: {
                ...settings.agent,
                codex: {
                  ...codexSettings,
                  command,
                },
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Default sandbox"
        desc="Default file access mode for approved Codex tool executions."
      >
        <ObsidianDropdown
          value={codexSettings.defaultSandbox}
          options={SANDBOX_OPTIONS}
          onChange={async (defaultSandbox) => {
            await setSettings({
              ...settings,
              agent: {
                ...settings.agent,
                codex: {
                  ...codexSettings,
                  defaultSandbox: defaultSandbox as CodexSandboxMode,
                },
              },
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Default approval"
        desc="CLI approval behavior after Smart Composer tool approval."
      >
        <ObsidianDropdown
          value={codexSettings.approvalPolicy}
          options={APPROVAL_OPTIONS}
          onChange={async (approvalPolicy) => {
            await setSettings({
              ...settings,
              agent: {
                ...settings.agent,
                codex: {
                  ...codexSettings,
                  approvalPolicy: approvalPolicy as CodexApprovalPolicy,
                },
              },
            })
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
