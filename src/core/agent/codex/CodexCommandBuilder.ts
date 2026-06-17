import type {
  CodexApprovalPolicy,
  CodexExecRequest,
  CodexResumeContext,
} from '../types'

const DEFAULT_APPROVAL_POLICY: CodexApprovalPolicy = 'default'
const DEFAULT_CODEX_COMMAND = 'codex'
const SKIP_GIT_REPO_CHECK_ARG = '--skip-git-repo-check'
const SAFE_THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export class CodexCommandBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexCommandBuildError'
  }
}

export class CodexCommandBuilder {
  buildExecArgv(request: CodexExecRequest): readonly string[] {
    const argv = [request.command ?? DEFAULT_CODEX_COMMAND]

    if (request.approvalPolicy !== DEFAULT_APPROVAL_POLICY) {
      argv.push('--ask-for-approval', request.approvalPolicy)
    }

    argv.push(...this.buildSubcommandArgv(request))
    return argv
  }

  private buildSubcommandArgv(request: CodexExecRequest): readonly string[] {
    if (canResume(request)) {
      assertSafeThreadId(request.resume.threadId)
      return [
        'exec',
        'resume',
        '--json',
        ...buildModelArgv(request.model),
        SKIP_GIT_REPO_CHECK_ARG,
        request.resume.threadId,
        '-',
      ]
    }

    return [
      'exec',
      '--json',
      ...buildModelArgv(request.model),
      SKIP_GIT_REPO_CHECK_ARG,
      '--cd',
      request.cwd,
      '--sandbox',
      request.sandboxMode,
    ]
  }
}

function buildModelArgv(model: string | undefined): readonly string[] {
  const trimmedModel = model?.trim()
  return trimmedModel ? ['--model', trimmedModel] : []
}

function canResume(
  request: CodexExecRequest,
): request is CodexExecRequest & { readonly resume: CodexResumeContext } {
  const resume = request.resume

  return (
    resume !== undefined &&
    resume.cwd === request.cwd &&
    resume.sandboxMode === request.sandboxMode &&
    resume.approvalPolicy === request.approvalPolicy
  )
}

function assertSafeThreadId(threadId: string): void {
  if (!SAFE_THREAD_ID_PATTERN.test(threadId)) {
    throw new CodexCommandBuildError(`Unsafe Codex thread id: ${threadId}`)
  }
}
