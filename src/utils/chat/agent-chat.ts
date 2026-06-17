import type { TFile } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import type { CodexAgentEvent } from '../../core/agent/types'
import {
  ChatAgentCommandMessage,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import { MentionableCurrentFile } from '../../types/mentionable'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

export const AGENT_CHAT_SUMMARY = 'Agent Chat'

export const AGENT_CHAT_CONTEXT_HEADING = '## Current Obsidian Markdown File'

type BuildAgentChatToolMessageParams = {
  readonly conversationId: string
  readonly prompt: string
  readonly isExecutionAllowed: (params: {
    readonly requestToolName: string
    readonly requestArgs?: string
    readonly conversationId?: string
  }) => boolean
}

type BuildAgentPromptParams = {
  readonly prompt: string
  readonly userMessage: ChatUserMessage
}

type CodexCommandExecutionItem = {
  readonly id: string
  readonly command: string
  readonly aggregatedOutput: string
  readonly exitCode: number | null
  readonly status: string
}

export function buildAgentChatToolMessage({
  conversationId,
  prompt,
  isExecutionAllowed,
}: BuildAgentChatToolMessageParams): ChatToolMessage {
  const requestArgs = JSON.stringify({
    prompt,
    summary: AGENT_CHAT_SUMMARY,
  })
  const request = {
    id: uuidv4(),
    name: CODEX_TOOL_NAME,
    arguments: requestArgs,
  }

  return {
    role: 'tool',
    id: uuidv4(),
    toolCalls: [
      {
        request,
        response: {
          status: isExecutionAllowed({
            requestToolName: request.name,
            requestArgs,
            conversationId,
          })
            ? ToolCallResponseStatus.Running
            : ToolCallResponseStatus.PendingApproval,
        },
      },
    ],
  }
}

export function buildAgentChatMessages(
  params: BuildAgentChatToolMessageParams,
): readonly [ChatAssistantMessage, ChatToolMessage] {
  const toolMessage = buildAgentChatToolMessage(params)
  const assistantMessage: ChatAssistantMessage = {
    role: 'assistant',
    content: '',
    id: uuidv4(),
    toolCallRequests: toolMessage.toolCalls.map((toolCall) => toolCall.request),
  }

  return [assistantMessage, toolMessage]
}

export function buildAgentChatRequestArgs(prompt: string): string {
  return JSON.stringify({
    prompt,
    summary: AGENT_CHAT_SUMMARY,
  })
}

export function buildAgentAssistantMessage(
  content: string,
): ChatAssistantMessage {
  return {
    role: 'assistant',
    content,
    id: uuidv4(),
  }
}

export function buildAgentPrompt({
  prompt,
  userMessage,
}: BuildAgentPromptParams): string {
  const currentFile = userMessage.mentionables.find(
    (mentionable): mentionable is MentionableCurrentFile =>
      mentionable.type === 'current-file',
  )?.file
  if (!currentFile || currentFile.extension !== 'md') {
    return prompt
  }

  return `${AGENT_CHAT_CONTEXT_HEADING}
Path: ${currentFile.path}

${prompt}`
}

export function withCurrentFileMentionable(
  message: ChatUserMessage,
  currentFile: TFile | null,
): ChatUserMessage {
  const mentionables = message.mentionables.map((mentionable) =>
    mentionable.type === 'current-file'
      ? {
          ...mentionable,
          file: currentFile,
        }
      : mentionable,
  )
  if (mentionables.some((mentionable) => mentionable.type === 'current-file')) {
    return {
      ...message,
      mentionables,
    }
  }

  return {
    ...message,
    mentionables: [
      {
        type: 'current-file',
        file: currentFile,
      },
      ...mentionables,
    ],
  }
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
  if (!item) {
    return null
  }

  return {
    role: 'agent-command',
    id: `agent-command:${item.id}`,
    command: item.command,
    output: item.aggregatedOutput,
    exitCode: item.exitCode,
    status: getAgentCommandStatus(item),
  }
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

export function isAgentChatTerminalMessage(message: ChatMessage): boolean {
  return message.role === 'tool' && isAgentChatToolMessage(message)
}

export function getRunningAgentChatToolCallIds(
  messages: readonly ChatMessage[],
): readonly string[] {
  return messages.flatMap((message) => {
    if (message.role !== 'tool' || !isAgentChatToolMessage(message)) {
      return []
    }

    return message.toolCalls
      .filter(
        (toolCall) =>
          toolCall.response.status === ToolCallResponseStatus.Running,
      )
      .map((toolCall) => toolCall.request.id)
  })
}

export function isAgentChatToolMessage(message: ChatToolMessage): boolean {
  if (message.toolCalls.length === 0) {
    return false
  }

  return message.toolCalls.every((toolCall) => {
    if (toolCall.request.name !== CODEX_TOOL_NAME) {
      return false
    }
    if (!toolCall.request.arguments) {
      return false
    }
    try {
      const args = JSON.parse(toolCall.request.arguments)
      return args.summary === AGENT_CHAT_SUMMARY
    } catch (error) {
      return false
    }
  })
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

  const aggregatedOutput =
    typeof item.aggregated_output === 'string' ? item.aggregated_output : ''
  const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null

  return {
    id: item.id,
    command: item.command,
    aggregatedOutput,
    exitCode,
    status: item.status,
  }
}

function getAgentCommandStatus(
  item: CodexCommandExecutionItem,
): ChatAgentCommandMessage['status'] {
  if (item.status !== 'completed') {
    return 'running'
  }
  return item.exitCode === 0 ? 'success' : 'error'
}
