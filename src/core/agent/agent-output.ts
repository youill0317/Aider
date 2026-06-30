import type { CodexAgentEvent } from './types'

export function statusMessage(status: string): string {
  switch (status) {
    case 'completed':
      return 'Codex run completed.'
    case 'cancelled':
      return 'Codex run cancelled.'
    case 'failed':
      return 'Codex run failed.'
    default:
      return `Codex run ended with status: ${status}`
  }
}

export function extractAgentText(event: CodexAgentEvent): string {
  if (event.kind !== 'item.completed' && event.kind !== 'item.updated') {
    return ''
  }
  if (event.item.type !== 'agent_message') {
    return ''
  }

  const content = event.item.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    const textParts: string[] = []
    for (const item of content) {
      const text = extractContentPartText(item)
      if (text.length > 0) {
        textParts.push(text)
      }
    }
    return textParts.join('\n')
  }

  const text = event.item.text
  return typeof text === 'string' ? text : ''
}

function extractContentPartText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('text' in value)
  ) {
    return ''
  }

  return typeof value.text === 'string' ? value.text : ''
}
