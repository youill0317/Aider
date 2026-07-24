import type {
  CodexApprovalPolicy,
  CodexResumeContext,
  CodexSandboxMode,
} from '../../types/codex'

export type {
  CodexApprovalPolicy,
  CodexResumeContext,
  CodexSandboxMode,
} from '../../types/codex'

type CodexThreadStartedEvent = {
  readonly kind: 'thread.started'
  readonly line: number
  readonly threadId: string
}

type CodexTurnEvent = {
  readonly kind: 'turn.started' | 'turn.completed' | 'turn.failed'
  readonly line: number
  readonly turnId?: string
}

type CodexItemEvent = {
  readonly kind: 'item.started' | 'item.updated' | 'item.completed'
  readonly line: number
  readonly item: Record<string, unknown>
}

type CodexErrorEvent = {
  readonly kind: 'error'
  readonly line: number
  readonly message: string
  readonly code?: string
}

type CodexUnknownEvent = {
  readonly kind: 'unknown'
  readonly line: number
  readonly type: string
  readonly payload: Record<string, unknown>
}

export type CodexAgentEvent =
  | CodexThreadStartedEvent
  | CodexTurnEvent
  | CodexItemEvent
  | CodexErrorEvent
  | CodexUnknownEvent

export type CodexExecRequest = {
  readonly command?: string
  readonly model?: string
  readonly prompt: string
  readonly cwd: string
  readonly sandboxMode: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
  readonly resume?: CodexResumeContext
}

export type CodexSessionRequest = {
  readonly initialPrompt: string
  readonly resume?: CodexResumeContext
}

type CodexRunStatus = 'completed' | 'failed' | 'cancelled'

export type CodexRunResult = {
  readonly status: CodexRunStatus
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
  readonly threadId: string | null
}

export type CodexRunHandle = {
  readonly done: Promise<CodexRunResult>
  abort: () => void
}

export type CodexPermissionOption = {
  readonly id: string
  readonly kind: string
  readonly name: string
}

export type CodexPermissionDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'

export type CodexPermissionRequest = {
  readonly details: Readonly<Record<string, unknown>>
  readonly id: string
  readonly options: readonly CodexPermissionOption[]
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly title: string
  readonly toolCallId: string
}

export type CodexRuntimeHandlers = {
  readonly onError?: (error: Error) => void
  readonly onEvent: (event: CodexAgentEvent) => void
  readonly onPermissionRequest?: (
    request: CodexPermissionRequest,
  ) => Promise<CodexPermissionDecision | null>
}

export type CodexRuntime = {
  execute: (
    request: CodexExecRequest,
    handlers: CodexRuntimeHandlers,
  ) => CodexRunHandle
  dispose?: () => Promise<void> | void
}
