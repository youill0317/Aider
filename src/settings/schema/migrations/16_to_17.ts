import type { SettingMigration } from '../setting.types'

const DEFAULT_CODEX_AGENT_SETTINGS = {
  enabled: true,
  command: 'codex',
  defaultSandbox: 'workspace-write',
  approvalPolicy: 'on-request',
  cwdMode: 'vault',
  customCwd: '',
  resume: true,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const migrateFrom16To17: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 17

  const existingAgent = isRecord(newData.agent) ? newData.agent : {}
  const existingCodex = isRecord(existingAgent.codex) ? existingAgent.codex : {}
  const {
    extraArgs: _extraArgs,
    webSearch: _webSearch,
    ...supportedCodex
  } = existingCodex

  newData.agent = {
    ...existingAgent,
    codex: {
      ...DEFAULT_CODEX_AGENT_SETTINGS,
      ...supportedCodex,
      approvalPolicy:
        supportedCodex.approvalPolicy === 'default'
          ? 'on-request'
          : (supportedCodex.approvalPolicy ??
            DEFAULT_CODEX_AGENT_SETTINGS.approvalPolicy),
      cwdMode: supportedCodex.cwdMode === 'custom' ? 'custom' : 'vault',
    },
  }

  return newData
}
