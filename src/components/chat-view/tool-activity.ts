import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import { InvalidToolNameException } from '../../core/mcp/exception'
import { parseToolName } from '../../core/mcp/tool-name-utils'
import type { ChatAgentCommandMessage, ChatToolMessage } from '../../types/chat'
import type {
  ToolCallRequest,
  ToolCallResponse,
} from '../../types/tool-call.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

export type ToolActivityMessage = ChatToolMessage | ChatAgentCommandMessage

export type ToolActivityStep =
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly request: ToolCallRequest
      readonly response: ToolCallResponse
      readonly title: string
      readonly summary: string | null
      readonly isActive: boolean
      readonly isSuccessful: boolean
    }
  | {
      readonly kind: 'agent-command'
      readonly id: string
      readonly message: ChatAgentCommandMessage
      readonly title: string
      readonly summary: string | null
      readonly isActive: boolean
      readonly isSuccessful: boolean
    }

const SUMMARY_NAME_LIMIT = 3
const SUMMARY_TEXT_LIMIT = 80
const SUMMARY_VALUE_DEPTH_LIMIT = 3

export function getToolActivitySteps(
  messages: readonly ToolActivityMessage[],
): ToolActivityStep[] {
  const steps: ToolActivityStep[] = []

  for (const message of messages) {
    if (message.role === 'tool') {
      for (const toolCall of message.toolCalls) {
        steps.push({
          kind: 'tool',
          id: `${message.id}:${toolCall.request.id}`,
          request: toolCall.request,
          response: toolCall.response,
          title: getToolDisplayName(toolCall.request.name),
          summary: getToolArgumentSummary(toolCall.request.arguments),
          isActive: isActiveToolResponse(toolCall.response),
          isSuccessful:
            toolCall.response.status === ToolCallResponseStatus.Success,
        })
      }
      continue
    }

    steps.push({
      kind: 'agent-command',
      id: message.id,
      message,
      title: message.title,
      summary: getAgentCommandSummary(message),
      isActive: message.status === 'running',
      isSuccessful: message.status === 'success',
    })
  }

  return steps
}

export function shouldUseActivityTimeline(
  steps: readonly ToolActivityStep[],
): boolean {
  return steps.length > 0 && !steps.some((step) => step.isActive)
}

export function shouldOpenActivityTimeline(
  steps: readonly ToolActivityStep[],
): boolean {
  return steps.some((step) => !step.isSuccessful)
}

export function getFirstSelectedStepId(
  steps: readonly ToolActivityStep[],
): string | null {
  return steps.find((step) => !step.isSuccessful)?.id ?? steps[0]?.id ?? null
}

export function getToolActivityHeader(
  steps: readonly ToolActivityStep[],
): string {
  const shownNames = steps
    .slice(0, SUMMARY_NAME_LIMIT)
    .map((step) => step.title)
  const hiddenCount = steps.length - shownNames.length
  const names =
    hiddenCount > 0 ? [...shownNames, `+${hiddenCount} more`] : shownNames
  const hasAgentCommand = steps.some((step) => step.kind === 'agent-command')
  const noun = hasAgentCommand
    ? steps.length === 1
      ? 'step'
      : 'steps'
    : steps.length === 1
      ? 'tool'
      : 'tools'

  return `${hasAgentCommand ? 'Ran' : 'Used'} ${steps.length} ${noun}: ${names.join(', ')}`
}

export function formatToolArguments(argumentsText?: string): string {
  if (!argumentsText) {
    return 'No parameters'
  }

  try {
    return JSON.stringify(JSON.parse(argumentsText), null, 2)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return argumentsText
    }
    throw error
  }
}

function isActiveToolResponse(response: ToolCallResponse): boolean {
  return (
    response.status === ToolCallResponseStatus.PendingApproval ||
    response.status === ToolCallResponseStatus.Running
  )
}

function getToolDisplayName(name: string): string {
  if (name === CODEX_TOOL_NAME) {
    return '>_'
  }

  try {
    const { serverName, toolName } = parseToolName(name)
    return serverName ? `${serverName}:${toolName}` : toolName
  } catch (error) {
    if (error instanceof InvalidToolNameException) {
      return name
    }
    throw error
  }
}

function getToolArgumentSummary(argumentsText?: string): string | null {
  if (!argumentsText) {
    return null
  }

  try {
    return summarizeValue(JSON.parse(argumentsText))
  } catch (error) {
    if (error instanceof SyntaxError) {
      return truncate(argumentsText)
    }
    throw error
  }
}

function getAgentCommandSummary(
  message: ChatAgentCommandMessage,
): string | null {
  const summary = message.detail || message.input || message.output
  return summary.length > 0 ? truncate(summary) : null
}

function summarizeValue(value: unknown, depth = 0): string | null {
  if (depth === SUMMARY_VALUE_DEPTH_LIMIT) {
    return '...'
  }

  if (typeof value === 'string') {
    return truncate(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`
  }

  if (!isRecord(value)) {
    return null
  }

  const firstEntry = Object.entries(value)[0]
  if (!firstEntry) {
    return null
  }

  const [key, firstValue] = firstEntry
  const valueSummary = summarizeValue(firstValue, depth + 1)
  return valueSummary ? `${key}: ${valueSummary}` : key
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(value: string): string {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  return normalizedValue.length > SUMMARY_TEXT_LIMIT
    ? `${normalizedValue.slice(0, SUMMARY_TEXT_LIMIT - 3)}...`
    : normalizedValue
}
