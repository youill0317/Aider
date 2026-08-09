import {
  McpServerConfig,
  McpServerParameters,
  McpServerState,
  McpServerStatus,
} from '../../types/mcp.types'
import {
  redactConfiguredEnvironmentValues,
  redactEnvironmentSecrets,
  redactSecrets,
} from '../../utils/security/redact-secrets'

function equalOptionalRecords(
  left?: Record<string, string>,
  right?: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left ?? {})
  const rightEntries = Object.entries(right ?? {})
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right?.[key] === value)
  )
}

function equalOptionalArrays(
  left?: readonly string[],
  right?: readonly string[],
): boolean {
  return (
    (left?.length ?? 0) === (right?.length ?? 0) &&
    (left ?? []).every((value, index) => right?.[index] === value)
  )
}

export function equalServerParameters(
  left: McpServerParameters,
  right: McpServerParameters,
): boolean {
  return (
    left.command === right.command &&
    equalOptionalArrays(left.args, right.args) &&
    equalOptionalRecords(left.env, right.env)
  )
}

export function equalServerToolOptions(
  left: McpServerConfig['toolOptions'],
  right: McpServerConfig['toolOptions'],
): boolean {
  const leftEntries = Object.entries(left)
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(
      ([name, option]) =>
        Object.prototype.hasOwnProperty.call(right, name) &&
        Object.prototype.hasOwnProperty.call(option, 'disabled') ===
          Object.prototype.hasOwnProperty.call(right[name], 'disabled') &&
        Object.prototype.hasOwnProperty.call(option, 'allowAutoExecution') ===
          Object.prototype.hasOwnProperty.call(
            right[name],
            'allowAutoExecution',
          ) &&
        option.disabled === right[name].disabled &&
        option.allowAutoExecution === right[name].allowAutoExecution,
    )
  )
}

export function hasAdvertisedTool(
  server: McpServerState,
  toolName: string,
): boolean {
  return (
    server.status === McpServerStatus.Connected &&
    server.tools.some((tool) => tool.name === toolName)
  )
}

export function redactMcpError(
  value: string,
  serverConfig?: McpServerConfig,
  inheritedEnv: NodeJS.ProcessEnv = {},
): string {
  const redacted = redactSecrets(value)
  return redactEnvironmentSecrets(
    redactConfiguredEnvironmentValues(
      redacted,
      serverConfig?.parameters.env ?? {},
    ),
    inheritedEnv,
  )
}
