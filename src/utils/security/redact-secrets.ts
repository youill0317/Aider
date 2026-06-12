const REDACTED = '[REDACTED]'

const SECRET_KEY_PATTERNS = [
  /api[_-]?key/i,
  /access[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /^code$/i,
  /authorization/i,
  /private[_-]?key/i,
  /secret/i,
  /ssh/i,
  /password/i,
  /token/i,
] as const

const BEARER_TOKEN_PATTERN = /(Authorization:\s*Bearer\s+)[^\s'",}]+/gi
const QUERY_SECRET_PATTERN =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|token|code)=)[^&\s'",}]+/gi

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
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
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSecretKey(key) ? REDACTED : redactSecrets(nestedValue),
    ]),
  )
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
