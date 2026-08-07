import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import type { ChatMessage } from '../../types/chat'
import type { CodexResumeContext } from '../../types/codex'
import {
  type ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import { redactSecrets } from '../security/redact-secrets'

import {
  type AgentSessionPrompts,
  appendAgentAssistantMessage,
  buildAgentChatRequestArgs,
  buildAgentCommandMessageFromEvent,
  upsertAgentCommandMessage,
} from './agent-chat'
import type { ToolDispatcher } from './tool-dispatcher'

type CallToolParams = Parameters<ToolDispatcher['callTool']>[0]

export type RunAgentTurnParams = {
  readonly callTool: (params: CallToolParams) => Promise<ToolCallResponse>
  /** Guards every state write so a superseded turn cannot touch the UI. */
  readonly isCurrent: () => boolean
  readonly onPermissionRequest?: CallToolParams['onPermissionRequest']
  readonly prompts: AgentSessionPrompts
  readonly setChatMessages: (
    updater: (previous: ChatMessage[]) => ChatMessage[],
  ) => void
  readonly signal: AbortSignal
  readonly toolCallId: string
}

/** The assistant text shown for a finished agent turn. */
export function agentTurnResultContent(response: ToolCallResponse): string {
  switch (response.status) {
    case ToolCallResponseStatus.Success:
      return response.data.text
    case ToolCallResponseStatus.Aborted:
      return 'Agent Chat was stopped.'
    case ToolCallResponseStatus.Error:
      return response.error
    default:
      return `Agent Chat ended with status: ${response.status}`
  }
}

function agentTurnSession(
  response: ToolCallResponse,
): CodexResumeContext | null {
  return response.status === ToolCallResponseStatus.Success
    ? (response.data.codexSession ?? null)
    : null
}

/**
 * Drives one Codex agent turn: streams command activity into the transcript and
 * appends the final assistant message. Never throws — a failed turn is reported
 * as an assistant message so the caller only has to unregister the tool call.
 */
export async function runAgentTurn({
  callTool,
  isCurrent,
  onPermissionRequest,
  prompts,
  setChatMessages,
  signal,
  toolCallId,
}: RunAgentTurnParams): Promise<void> {
  try {
    const response = await callTool({
      name: CODEX_TOOL_NAME,
      args: buildAgentChatRequestArgs(prompts.prompt),
      codexSession: {
        initialPrompt: prompts.initialPrompt,
        resume: prompts.resume,
      },
      id: toolCallId,
      onPermissionRequest,
      onEvent: (event) => {
        if (!isCurrent()) return
        const commandMessage = buildAgentCommandMessageFromEvent(event)
        if (!commandMessage) return
        setChatMessages((previous) =>
          upsertAgentCommandMessage(previous, commandMessage),
        )
      },
      signal,
    })
    if (!isCurrent()) return
    setChatMessages((previous) =>
      appendAgentAssistantMessage(
        previous,
        agentTurnResultContent(response),
        agentTurnSession(response),
      ),
    )
  } catch (error) {
    if (!isCurrent()) return
    setChatMessages((previous) =>
      appendAgentAssistantMessage(
        previous,
        redactSecrets(error instanceof Error ? error.message : String(error)),
      ),
    )
  }
}
