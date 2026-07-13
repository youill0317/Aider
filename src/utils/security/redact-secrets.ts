const REDACTED = '[REDACTED]'

const SECRET_KEY_PATTERN =
  /api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|^code$|authorization|private[_-]?key|secret|ssh|password|token|(?:^|[_-])key$|(?:^|[_-])(?:database|redis)[_-]?url$/i

const BEARER_TOKEN_PATTERN = /(Authorization:\s*Bearer\s+)[^\s'",}]+/gi
const QUERY_SECRET_PATTERN =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|token|code)=)[^&\s'",}]+/gi
const QUOTED_SECRET_ASSIGNMENT_PATTERN =
  /((?:[A-Z0-9_]*?(?:API[_-]?KEY|ACCESS[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|ID[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*?)=)(["'])(?:\\[\s\S]|(?!\2)[\s\S])*\2/gi
const SECRET_ASSIGNMENT_PATTERN =
  /((?:[A-Z0-9_]*?(?:API[_-]?KEY|ACCESS[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|ID[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*?)=)[^&\s'",}]+/gi

function redactSecretAssignments(value: string): string {
  if (!value.includes('=')) return value
  return value
    .replace(
      QUOTED_SECRET_ASSIGNMENT_PATTERN,
      (_match, assignment: string, quote: string) =>
        `${assignment}${quote}${REDACTED}${quote}`,
    )
    .replace(SECRET_ASSIGNMENT_PATTERN, `$1${REDACTED}`)
}

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
      return redactSecretAssignments(
        value
          .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
          .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`),
      )
    }
  }

  return redactSecretAssignments(
    value
      .replace(BEARER_TOKEN_PATTERN, `$1${REDACTED}`)
      .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`),
  )
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

export function redactEnvironmentSecrets(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  return redactEnvironmentValues(value, env, (key) => isSecretKey(key))
}

export function redactAllEnvironmentValues(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  return redactEnvironmentValues(value, env, () => true)
}

function redactEnvironmentValues(
  value: string,
  env: NodeJS.ProcessEnv,
  shouldRedact: (key: string) => boolean,
): string {
  let redacted = redactString(value)
  for (const [key, secret] of Object.entries(env)) {
    if (secret && shouldRedact(key)) {
      redacted = redacted.split(secret).join(REDACTED)
    }
  }
  return redacted
}
