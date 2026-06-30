import {
  McpServerConfig,
  McpServerParameters,
  McpServerState,
  McpServerStatus,
} from '../../types/mcp.types'
import { redactSecrets } from '../../utils/security/redact-secrets'

const SECRET_ENV_KEY_PATTERN =
  /(access[-_]?key|api[-_]?key|auth|bearer|credential|pat|password|private[-_]?key|secret|ssh|token)/i

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

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY_PATTERN.test(key)
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

export function mergeMcpRedactionEnv(
  defaultEnv: Record<string, string>,
  serverConfig: McpServerConfig,
): Record<string, string> {
  return {
    ...defaultEnv,
    ...(serverConfig.parameters.env ?? {}),
  }
}

export function withMcpRedactionEnv(
  serverConfig: McpServerConfig,
  env: Record<string, string>,
): McpServerConfig {
  return {
    ...serverConfig,
    parameters: {
      ...serverConfig.parameters,
      env,
    },
  }
}

export function redactMcpError(
  value: string,
  serverConfig?: McpServerConfig,
): string {
  const env = serverConfig?.parameters.env ?? {}
  const redacted = redactSecrets({
    message: value,
    env,
  })
  const redactedMessage =
    typeof redacted.message === 'string' ? redacted.message : value

  let message = redactedMessage
  for (const [envKey, envValue] of Object.entries(env)) {
    if (isSecretEnvKey(envKey) && envValue.length > 0) {
      message = message.split(envValue).join('[REDACTED]')
    }
  }
  return message
}
