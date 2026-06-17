import type { CodexAgentEvent } from '../types'

type CodexRawLine = {
  readonly type: string
  readonly value: Record<string, unknown>
}

export class CodexJsonlParseError extends Error {
  readonly line: number

  constructor(line: number, cause: string) {
    super(`Malformed Codex JSONL at line ${line}: ${cause}`)
    this.name = 'CodexJsonlParseError'
    this.line = line
  }
}

export class CodexJsonlParser {
  private buffer = ''
  private nextLine = 1

  push(chunk: string): CodexAgentEvent[] {
    this.buffer += chunk
    const events: CodexAgentEvent[] = []

    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      const event = parseLine(line, this.nextLine)
      this.nextLine += 1

      if (event !== undefined) {
        events.push(event)
      }

      newlineIndex = this.buffer.indexOf('\n')
    }

    return events
  }

  flush(): CodexAgentEvent[] {
    if (this.buffer.length === 0) {
      return []
    }

    const line = this.buffer
    this.buffer = ''
    const event = parseLine(line, this.nextLine)
    this.nextLine += 1

    return event === undefined ? [] : [event]
  }
}

function parseLine(
  line: string,
  lineNumber: number,
): CodexAgentEvent | undefined {
  const trimmedLine = line.trim()
  if (trimmedLine.length === 0) {
    return undefined
  }

  const raw = parseJsonLine(trimmedLine, lineNumber)

  switch (raw.type) {
    case 'thread.started':
      return {
        kind: raw.type,
        line: lineNumber,
        threadId: readRequiredString(raw.value, 'thread_id', lineNumber),
      }
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
      return removeUndefinedValues({
        kind: raw.type,
        line: lineNumber,
        turnId: readOptionalString(raw.value, 'turn_id', lineNumber),
      })
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return {
        item: readRequiredRecord(raw.value, 'item', lineNumber),
        kind: raw.type,
        line: lineNumber,
      }
    case 'error':
      return parseErrorEvent(raw.value, lineNumber)
    default:
      return {
        kind: 'unknown',
        line: lineNumber,
        payload: raw.value,
        type: raw.type,
      }
  }
}

function parseJsonLine(line: string, lineNumber: number): CodexRawLine {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isRecord(parsed)) {
      throw new CodexJsonlParseError(lineNumber, 'expected an object')
    }

    const type = parsed.type
    if (typeof type !== 'string') {
      throw new CodexJsonlParseError(lineNumber, 'expected string type')
    }

    return { type, value: parsed }
  } catch (error) {
    if (error instanceof CodexJsonlParseError) {
      throw error
    }
    if (error instanceof SyntaxError) {
      throw new CodexJsonlParseError(lineNumber, error.message)
    }
    throw error
  }
}

function parseErrorEvent(
  value: Record<string, unknown>,
  lineNumber: number,
): CodexAgentEvent {
  const message = readRequiredString(value, 'message', lineNumber)
  const code = value.code

  if (code === undefined) {
    return {
      kind: 'error',
      line: lineNumber,
      message,
    }
  }

  if (typeof code !== 'string') {
    throw new CodexJsonlParseError(lineNumber, 'expected string code')
  }

  return {
    code,
    kind: 'error',
    line: lineNumber,
    message,
  }
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  lineNumber: number,
): string {
  const fieldValue = value[key]
  if (typeof fieldValue !== 'string') {
    throw new CodexJsonlParseError(lineNumber, `expected string ${key}`)
  }

  return fieldValue
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  lineNumber: number,
): string | undefined {
  const fieldValue = value[key]
  if (fieldValue === undefined) {
    return undefined
  }
  if (typeof fieldValue !== 'string') {
    throw new CodexJsonlParseError(lineNumber, `expected string ${key}`)
  }

  return fieldValue
}

function readRequiredRecord(
  value: Record<string, unknown>,
  key: string,
  lineNumber: number,
): Record<string, unknown> {
  const fieldValue = value[key]
  if (!isRecord(fieldValue)) {
    throw new CodexJsonlParseError(lineNumber, `expected object ${key}`)
  }

  return fieldValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T
}
