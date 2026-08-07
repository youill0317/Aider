import type { TFile } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import {
  CODEX_TOOL_NAME,
  MAX_CODEX_TOOL_PROMPT_CHARS,
} from '../../core/agent/CodexToolRunner'
import {
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
  ChatUserMessage,
} from '../../types/chat'
import type { CodexResumeContext } from '../../types/codex'
import { MentionableCurrentFile } from '../../types/mentionable'
import { ToolCallResponseStatus } from '../../types/tool-call.types'
import { redactSecrets } from '../security/redact-secrets'

import {
  wrapUntrustedContext,
  wrapUntrustedToolOutput,
} from './untrusted-context'
export {
  buildAgentCommandMessageFromEvent,
  upsertAgentCommandMessage,
} from './agent-events'

export const AGENT_CHAT_SUMMARY = 'Agent Chat'

export const AGENT_CHAT_CONTEXT_HEADING = '## Current Obsidian Markdown File'
const MAX_AGENT_HISTORY_CONTENT_CHARS = 24_000
const AGENT_CHAT_TRUNCATION_NOTICE = '[Earlier agent context truncated]\n'

type BuildAgentPromptParams = {
  readonly messages: readonly ChatMessage[]
  readonly prompt: string
  readonly userMessage: ChatUserMessage
}

export type AgentSessionPrompts = {
  readonly initialPrompt: string
  readonly prompt: string
  readonly resume?: CodexResumeContext
}

export function buildAgentChatRequestArgs(prompt: string): string {
  return JSON.stringify({
    prompt,
    summary: AGENT_CHAT_SUMMARY,
  })
}

export function buildAgentAssistantMessage(
  content: string,
  agentSession: CodexResumeContext | null = null,
): ChatAssistantMessage {
  return {
    role: 'assistant',
    content,
    id: uuidv4(),
    metadata: { agentSession },
  }
}

export function appendAgentAssistantMessage(
  messages: readonly ChatMessage[],
  content: string,
  agentSession: CodexResumeContext | null = null,
): ChatMessage[] {
  return [
    ...invalidateAgentSessions(messages),
    buildAgentAssistantMessage(content, agentSession),
  ]
}

export function invalidateAgentSessions(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map((message) =>
    message.role === 'assistant' && message.metadata?.agentSession
      ? {
          ...message,
          metadata: { ...message.metadata, agentSession: null },
        }
      : message,
  )
}

export function buildAgentSessionPrompts(
  params: BuildAgentPromptParams,
): AgentSessionPrompts {
  const initialPrompt = buildAgentPrompt(params)
  const previousAgentResponse = findLatestAgentResponse(params.messages)
  if (!previousAgentResponse?.session) {
    return { initialPrompt, prompt: initialPrompt }
  }

  return {
    initialPrompt,
    prompt: buildAgentPrompt({
      ...params,
      messages: params.messages.slice(previousAgentResponse.index + 1),
    }),
    resume: previousAgentResponse.session,
  }
}

export function buildAgentPrompt({
  messages,
  prompt,
  userMessage,
}: BuildAgentPromptParams): string {
  const currentFile = userMessage.mentionables.find(
    (mentionable): mentionable is MentionableCurrentFile =>
      mentionable.type === 'current-file',
  )?.file
  const currentFileContext =
    currentFile?.extension === 'md'
      ? `${AGENT_CHAT_CONTEXT_HEADING}
Path: ${currentFile.path}

`
      : ''
  const conversationPrompt = buildAgentConversationPrompt({
    fallbackPrompt: prompt,
    maxChars: MAX_CODEX_TOOL_PROMPT_CHARS - currentFileContext.length,
    messages,
  })
  return `${currentFileContext}${conversationPrompt}`
}

function findLatestAgentResponse(messages: readonly ChatMessage[]): {
  readonly index: number
  readonly session: CodexResumeContext | null
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.role === 'assistant' &&
      message.metadata?.agentSession !== undefined
    ) {
      return { index, session: message.metadata.agentSession }
    }
  }
  return null
}

function buildAgentConversationPrompt({
  fallbackPrompt,
  maxChars,
  messages,
}: {
  readonly fallbackPrompt: string
  readonly maxChars: number
  readonly messages: readonly ChatMessage[]
}): string {
  const reverseTranscript: string[] = []
  let transcriptChars = 0
  let truncated = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = formatAgentHistoryMessage(messages[index])
    if (!line) continue
    const addedChars = line.length + (reverseTranscript.length > 0 ? 2 : 0)
    if (transcriptChars + addedChars > maxChars) {
      truncated = true
      break
    }
    reverseTranscript.push(line)
    transcriptChars += addedChars
  }
  if (!truncated) {
    const transcript = reverseTranscript.reverse().join('\n\n')
    if (transcript || fallbackPrompt.length <= maxChars) {
      return transcript || fallbackPrompt
    }
  }

  const availableChars = maxChars - AGENT_CHAT_TRUNCATION_NOTICE.length
  while (transcriptChars > availableChars) {
    const removedLine = reverseTranscript.pop()
    if (removedLine === undefined) break
    transcriptChars -= removedLine.length
    if (reverseTranscript.length > 0) transcriptChars -= 2
  }

  if (reverseTranscript.length === 0) {
    if (fallbackPrompt.length > availableChars) {
      throw new Error('Latest Agent request is too large')
    }
    return `${AGENT_CHAT_TRUNCATION_NOTICE}${fallbackPrompt}`
  }

  return `${AGENT_CHAT_TRUNCATION_NOTICE}${reverseTranscript
    .reverse()
    .join('\n\n')}`
}

function formatAgentHistoryMessage(message: ChatMessage): string {
  switch (message.role) {
    case 'user':
      return `User:\n${formatUserPromptContent(message.promptContent)}`
    case 'assistant':
      return message.content.trim()
        ? `Assistant:\n${sanitizeUntrustedContext(message.content)}`
        : ''
    case 'tool':
      return formatToolMessage(message)
    case 'agent-command': {
      const activity = [
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
      return activity ? sanitizeUntrustedToolOutput(activity) : ''
    }
  }
}

function sanitizeUntrustedContext(content: string): string {
  return wrapUntrustedContext(redactAndLimitAgentHistoryContent(content))
}

function sanitizeUntrustedToolOutput(content: string): string {
  return wrapUntrustedToolOutput(redactAndLimitAgentHistoryContent(content))
}

function redactAndLimitAgentHistoryContent(content: string): string {
  const redactedContent = redactSecrets(content)
  if (redactedContent.length <= MAX_AGENT_HISTORY_CONTENT_CHARS) {
    return redactedContent
  }

  return `${redactedContent.slice(0, MAX_AGENT_HISTORY_CONTENT_CHARS)}
[Truncated]`
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
      let content: string
      switch (toolCall.response.status) {
        case ToolCallResponseStatus.PendingApproval:
        case ToolCallResponseStatus.Running:
        case ToolCallResponseStatus.Rejected:
        case ToolCallResponseStatus.Aborted:
          content = `${header}\nTool call ${toolCall.request.id} is ${toolCall.response.status}`
          break
        case ToolCallResponseStatus.Success:
          content = `${header}\n${toolCall.response.data.text}`
          break
        case ToolCallResponseStatus.Error:
          content = `${header}\nError:\n${toolCall.response.error}`
          break
      }
      return sanitizeUntrustedToolOutput(content)
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
