import { redactSecrets } from '../../utils/security/redact-secrets'

export function redactAuthError(
  error: unknown,
  secretValues: readonly string[] = [],
): Error | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const redactedMessage = secretValues.reduce(
    (message, secretValue) =>
      secretValue.length > 0
        ? message.split(secretValue).join('[REDACTED]')
        : message,
    redactSecrets(error.message),
  )
  return new Error(redactedMessage)
}
