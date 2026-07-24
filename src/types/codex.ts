export type CodexSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type CodexApprovalPolicy = 'never' | 'on-request' | 'untrusted'

export type CodexResumeContext = {
  readonly threadId: string
  readonly cwd: string
  readonly sandboxMode: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
}
