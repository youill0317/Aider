export type CodexSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type CodexApprovalPolicy =
  | 'default'
  | 'never'
  | 'on-request'
  | 'untrusted'

export type CodexThreadStartedEvent = {
  readonly kind: 'thread.started'
  readonly line: number
  readonly threadId: string
}

export type CodexTurnEvent = {
  readonly kind: 'turn.started' | 'turn.completed' | 'turn.failed'
  readonly line: number
  readonly turnId?: string
}

export type CodexItemEvent = {
  readonly kind: 'item.started' | 'item.updated' | 'item.completed'
  readonly line: number
  readonly item: Record<string, unknown>
}

export type CodexErrorEvent = {
  readonly kind: 'error'
  readonly line: number
  readonly message: string
  readonly code?: string
}

export type CodexUnknownEvent = {
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

export type CodexResumeContext = {
  readonly threadId: string
  readonly cwd: string
  readonly sandboxMode: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
}

export type CodexExecRequest = {
  readonly command?: string
  readonly model?: string
  readonly prompt: string
  readonly cwd: string
  readonly sandboxMode: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
  readonly resume?: CodexResumeContext
}

export type CodexRunStatus = 'completed' | 'failed' | 'cancelled'

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

export type CodexPermissionRequest = {
  readonly id: string
  readonly options: readonly CodexPermissionOption[]
  readonly sessionId: string
  readonly title: string
  readonly toolCallId: string
}

export type CodexRuntimeHandlers = {
  readonly onError?: (error: Error) => void
  readonly onEvent: (event: CodexAgentEvent) => void
  readonly onPermissionRequest?: (
    request: CodexPermissionRequest,
  ) => Promise<string | null>
}

export type CodexRuntime = {
  execute: (
    request: CodexExecRequest,
    handlers: CodexRuntimeHandlers,
  ) => CodexRunHandle
}
