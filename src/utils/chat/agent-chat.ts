import type { TFile } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import { MentionableCurrentFile } from '../../types/mentionable'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { getLastChatTurns } from './promptGenerator'
export {
  buildAgentCommandMessageFromEvent,
  upsertAgentCommandMessage,
} from './agent-events'

export const AGENT_CHAT_SUMMARY = 'Agent Chat'

export const AGENT_CHAT_CONTEXT_HEADING = '## Current Obsidian Markdown File'
const AGENT_CHAT_HISTORY_TURNS = 10

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
  readonly messages: readonly ChatMessage[]
  readonly prompt: string
  readonly userMessage: ChatUserMessage
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
  messages,
  prompt,
  userMessage,
}: BuildAgentPromptParams): string {
  const conversationPrompt = buildAgentConversationPrompt({
    fallbackPrompt: prompt,
    messages,
  })
  const currentFile = userMessage.mentionables.find(
    (mentionable): mentionable is MentionableCurrentFile =>
      mentionable.type === 'current-file',
  )?.file
  if (!currentFile || currentFile.extension !== 'md') {
    return conversationPrompt
  }

  return `${AGENT_CHAT_CONTEXT_HEADING}
Path: ${currentFile.path}

${conversationPrompt}`
}

function buildAgentConversationPrompt({
  fallbackPrompt,
  messages,
}: {
  readonly fallbackPrompt: string
  readonly messages: readonly ChatMessage[]
}): string {
  const contextMessages = getLastChatTurns(messages, AGENT_CHAT_HISTORY_TURNS)
  if (contextMessages.length === 0) {
    return fallbackPrompt
  }

  const transcript = contextMessages
    .map((message) => formatAgentHistoryMessage(message))
    .filter((line) => line.length > 0)
    .join('\n\n')

  return transcript || fallbackPrompt
}

function formatAgentHistoryMessage(message: ChatMessage): string {
  switch (message.role) {
    case 'user':
      return `User:\n${formatUserPromptContent(message.promptContent)}`
    case 'assistant':
      return message.content.trim() ? `Assistant:\n${message.content}` : ''
    case 'tool':
      return formatToolMessage(message)
    case 'agent-command':
      return [
        [message.title, message.detail].filter(Boolean).join(' '),
        `Status: ${message.status}`,
        ...(message.exitCode !== undefined
          ? [`Exit code: ${message.exitCode ?? 'running'}`]
          : []),
        message.input,
        message.output,
      ]
        .filter((line) => line.length > 0)
        .join('\n')
  }
}

function formatUserPromptContent(
  promptContent: ChatUserMessage['promptContent'],
): string {
  if (typeof promptContent === 'string') {
    return promptContent
  }
  if (Array.isArray(promptContent)) {
    return promptContent
      .map((part) => (part.type === 'text' ? part.text : '[Image attachment]'))
      .join('\n')
  }
  return ''
}

function formatToolMessage(message: ChatToolMessage): string {
  return message.toolCalls
    .map((toolCall) => {
      const header = `Tool ${toolCall.request.name}:`
      switch (toolCall.response.status) {
        case ToolCallResponseStatus.PendingApproval:
        case ToolCallResponseStatus.Running:
        case ToolCallResponseStatus.Rejected:
        case ToolCallResponseStatus.Aborted:
          return `${header}\nTool call ${toolCall.request.id} is ${toolCall.response.status}`
        case ToolCallResponseStatus.Success:
          return `${header}\n${toolCall.response.data.text}`
        case ToolCallResponseStatus.Error:
          return `${header}\nError:\n${toolCall.response.error}`
      }
    })
    .join('\n\n')
}

export function withCurrentFileMentionable(
  message: ChatUserMessage,
  currentFile: TFile | null,
): ChatUserMessage {
  let hasCurrentFile = false
  const mentionables = message.mentionables.map((mentionable) => {
    if (mentionable.type !== 'current-file') {
      return mentionable
    }

    hasCurrentFile = true
    return {
      ...mentionable,
      file: currentFile,
    }
  })
  if (hasCurrentFile) {
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

export function isAgentChatTerminalMessage(message: ChatMessage): boolean {
  return message.role === 'tool' && isAgentChatToolMessage(message)
}

export function getRunningAgentChatToolCallIds(
  messages: readonly ChatMessage[],
): readonly string[] {
  const toolCallIds: string[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || !isAgentChatToolMessage(message)) {
      continue
    }

    for (const toolCall of message.toolCalls) {
      if (toolCall.response.status === ToolCallResponseStatus.Running) {
        toolCallIds.push(toolCall.request.id)
      }
    }
  }

  return toolCallIds
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
