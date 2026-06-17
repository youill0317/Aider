import type { CodexAgentEvent } from '../../core/agent/types'
import type { ChatAgentCommandMessage, ChatMessage } from '../../types/chat'

type AgentActivityStatus = ChatAgentCommandMessage['status']

type CodexCommandExecutionItem = {
  readonly id: string
  readonly command: string
  readonly aggregatedOutput: string
  readonly exitCode: number | null
  readonly status: string
}

type CodexWebSearchItem = {
  readonly id: string
  readonly query: string
  readonly action: unknown
}

type CodexMcpToolCallItem = {
  readonly id: string
  readonly server: string
  readonly tool: string
  readonly arguments: unknown
  readonly result: unknown
  readonly error: string | null
  readonly status: string
}

export function buildAgentCommandMessageFromEvent(
  event: CodexAgentEvent,
): ChatAgentCommandMessage | null {
  if (
    event.kind !== 'item.started' &&
    event.kind !== 'item.updated' &&
    event.kind !== 'item.completed'
  ) {
    return null
  }

  const item = parseCodexCommandExecutionItem(event.item)
  if (item) {
    return {
      role: 'agent-command',
      id: `agent-command:${item.id}`,
      title: '>_',
      detail: item.command,
      input: '',
      output: item.aggregatedOutput,
      exitCode: item.exitCode,
      kind: 'command',
      status: getCommandStatus(item),
    }
  }

  const webSearchItem = parseCodexWebSearchItem(event.item)
  if (webSearchItem) {
    return {
      role: 'agent-command',
      id: `agent-command:${webSearchItem.id}`,
      title: 'Web search',
      detail: webSearchItem.query || 'Searching',
      input: formatUnknown(webSearchItem.action),
      output: webSearchItem.query,
      kind: 'web-search',
      status: getLifecycleStatus(event.kind),
    }
  }

  const mcpToolItem = parseCodexMcpToolCallItem(event.item)
  if (mcpToolItem) {
    return {
      role: 'agent-command',
      id: `agent-command:${mcpToolItem.id}`,
      title: `${mcpToolItem.server}:${mcpToolItem.tool}`,
      detail: mcpToolItem.status,
      input: formatUnknown(mcpToolItem.arguments),
      output: mcpToolItem.error ?? formatUnknown(mcpToolItem.result),
      kind: 'mcp-tool',
      status: getToolStatus(mcpToolItem.status),
    }
  }

  return null
}

export function upsertAgentCommandMessage(
  messages: readonly ChatMessage[],
  commandMessage: ChatAgentCommandMessage,
): ChatMessage[] {
  const existingIndex = messages.findIndex(
    (message) => message.id === commandMessage.id,
  )
  if (existingIndex === -1) {
    return [...messages, commandMessage]
  }

  return messages.map((message, index) =>
    index === existingIndex ? commandMessage : message,
  )
}

function parseCodexCommandExecutionItem(
  item: Record<string, unknown>,
): CodexCommandExecutionItem | null {
  if (item.type !== 'command_execution') {
    return null
  }
  if (typeof item.id !== 'string' || typeof item.command !== 'string') {
    return null
  }
  if (typeof item.status !== 'string') {
    return null
  }

  return {
    id: item.id,
    command: item.command,
    aggregatedOutput:
      typeof item.aggregated_output === 'string' ? item.aggregated_output : '',
    exitCode: typeof item.exit_code === 'number' ? item.exit_code : null,
    status: item.status,
  }
}

function parseCodexWebSearchItem(
  item: Record<string, unknown>,
): CodexWebSearchItem | null {
  if (item.type !== 'web_search' || typeof item.id !== 'string') {
    return null
  }
  return {
    id: item.id,
    query: typeof item.query === 'string' ? item.query : '',
    action: item.action,
  }
}

function parseCodexMcpToolCallItem(
  item: Record<string, unknown>,
): CodexMcpToolCallItem | null {
  if (item.type !== 'mcp_tool_call') {
    return null
  }
  if (
    typeof item.id !== 'string' ||
    typeof item.server !== 'string' ||
    typeof item.tool !== 'string' ||
    typeof item.status !== 'string'
  ) {
    return null
  }

  const error = item.error
  return {
    id: item.id,
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
    result: item.result,
    error:
      isRecord(error) && typeof error.message === 'string'
        ? error.message
        : null,
    status: item.status,
  }
}

function getCommandStatus(
  item: CodexCommandExecutionItem,
): AgentActivityStatus {
  if (item.status !== 'completed') {
    return 'running'
  }
  return item.exitCode === 0 ? 'success' : 'error'
}

function getLifecycleStatus(
  kind: CodexAgentEvent['kind'],
): AgentActivityStatus {
  return kind === 'item.completed' ? 'success' : 'running'
}

function getToolStatus(status: string): AgentActivityStatus {
  if (status === 'completed') {
    return 'success'
  }
  if (status === 'failed') {
    return 'error'
  }
  return 'running'
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
