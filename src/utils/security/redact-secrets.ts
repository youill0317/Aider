const REDACTED = '[REDACTED]'

const SECRET_KEY_PATTERN =
  /api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|^code$|authorization|private[_-]?key|secret|ssh|password|token/i

const BEARER_TOKEN_PATTERN = /(Authorization:\s*Bearer\s+)[^\s'",}]+/gi
const QUERY_SECRET_PATTERN =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|token|code)=)[^&\s'",}]+/gi

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

function redactString(value: string): string {
  const trimmedValue = value.trim()

  if (
    (trimmedValue.startsWith('{') && trimmedValue.endsWith('}')) ||
    (trimmedValue.startsWith('[') && trimmedValue.endsWith(']'))
  ) {
    try {
      return JSON.stringify(redactSecrets(JSON.parse(value)))
    } catch {
      return value
        .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
        .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`)
    }
  }

  return value
    .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
    .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`)
}

function redactRecord(value: object): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? REDACTED : redactSecrets(nestedValue)
  }
  return redacted
}

export function redactSecrets(value: string): string
export function redactSecrets(value: Error): Error
export function redactSecrets(value: readonly unknown[]): readonly unknown[]
export function redactSecrets(
  value: Record<string, unknown>,
): Record<string, unknown>
export function redactSecrets(value: unknown): unknown
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value)
  }

  if (value instanceof Error) {
    const redactedError = new Error(redactString(value.message))
    redactedError.name = value.name
    return redactedError
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item))
  }

  if (value !== null && typeof value === 'object') {
    return redactRecord(value)
  }

  return value
}
