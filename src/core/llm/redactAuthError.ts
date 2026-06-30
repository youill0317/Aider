import { redactSecrets } from '../../utils/security/redact-secrets'

export function redactAuthError(
  error: unknown,
  secretValues: readonly string[] = [],
): Error | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  let redactedMessage = redactSecrets(error.message)
  for (const secretValue of secretValues) {
    if (secretValue.length > 0) {
      redactedMessage = redactedMessage.split(secretValue).join('[REDACTED]')
    }
  }
  return new Error(redactedMessage)
}
