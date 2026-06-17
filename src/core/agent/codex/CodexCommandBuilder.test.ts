import { CodexCommandBuilder } from './CodexCommandBuilder'

describe('CodexCommandBuilder', () => {
  it('builds codex exec json argv with cwd, sandbox, and approval before exec', () => {
    // Given: a non-default Codex execution request.
    const builder = new CodexCommandBuilder()

    // When: argv is built.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'on-request',
      cwd: '/vault',
      prompt: 'Summarize the active note',
      sandboxMode: 'workspace-write',
    })

    // Then: approval is placed before exec, trust check is skipped for vaults,
    // and the prompt stays off argv.
    expect(argv).toEqual([
      'codex',
      '--ask-for-approval',
      'on-request',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--cd',
      '/vault',
      '--sandbox',
      'workspace-write',
    ])
  })

  it('omits default approval and always sends sandbox for the default run shape', () => {
    // Given: a default Codex execution request.
    const builder = new CodexCommandBuilder()

    // When: argv is built.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'default',
      cwd: '/vault',
      prompt: 'Continue',
      sandboxMode: 'read-only',
    })

    // Then: approval is omitted and sandbox is explicit for session matching.
    expect(argv).toEqual([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--cd',
      '/vault',
      '--sandbox',
      'read-only',
    ])
  })

  it('passes an explicit model to a new Codex run', () => {
    // Given: a request that selects a Codex model for this run.
    const builder = new CodexCommandBuilder()

    // When: argv is built.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'default',
      cwd: '/vault',
      model: 'gpt-5.1-codex',
      prompt: 'Continue',
      sandboxMode: 'read-only',
    })

    // Then: model selection is passed to the exec subcommand.
    expect(argv).toEqual([
      'codex',
      'exec',
      '--json',
      '--model',
      'gpt-5.1-codex',
      '--skip-git-repo-check',
      '--cd',
      '/vault',
      '--sandbox',
      'read-only',
    ])
  })

  it('resumes only when saved execution context matches', () => {
    // Given: a saved Codex thread context and a matching request.
    const builder = new CodexCommandBuilder()

    // When: argv is built for a compatible resume.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'on-request',
      cwd: '/vault',
      prompt: 'Keep going',
      resume: {
        approvalPolicy: 'on-request',
        cwd: '/vault',
        sandboxMode: 'workspace-write',
        threadId: 'thread-1',
      },
      sandboxMode: 'workspace-write',
    })

    // Then: the existing thread is resumed without new-run cwd or sandbox flags.
    expect(argv).toEqual([
      'codex',
      '--ask-for-approval',
      'on-request',
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      'thread-1',
      '-',
    ])
  })

  it('passes an explicit model when resuming a Codex thread', () => {
    // Given: a compatible resume request with an explicit model.
    const builder = new CodexCommandBuilder()

    // When: argv is built.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'default',
      cwd: '/vault',
      model: 'gpt-5.1-codex',
      prompt: 'Keep going',
      resume: {
        approvalPolicy: 'default',
        cwd: '/vault',
        sandboxMode: 'workspace-write',
        threadId: 'thread-1',
      },
      sandboxMode: 'workspace-write',
    })

    // Then: model selection stays on the resume subcommand.
    expect(argv).toEqual([
      'codex',
      'exec',
      'resume',
      '--json',
      '--model',
      'gpt-5.1-codex',
      '--skip-git-repo-check',
      'thread-1',
      '-',
    ])
  })

  it('rejects unsafe resume thread ids before building argv', () => {
    // Given: a saved thread id that could be interpreted as an option.
    const builder = new CodexCommandBuilder()

    // When/Then: argv building rejects the unsafe positional argument.
    expect(() =>
      builder.buildExecArgv({
        approvalPolicy: 'on-request',
        cwd: '/vault',
        prompt: 'Keep going',
        resume: {
          approvalPolicy: 'on-request',
          cwd: '/vault',
          sandboxMode: 'workspace-write',
          threadId: '--help',
        },
        sandboxMode: 'workspace-write',
      }),
    ).toThrow('Unsafe Codex thread id')
  })

  it('starts a new run when resume context does not match', () => {
    // Given: a saved Codex thread context from a different sandbox.
    const builder = new CodexCommandBuilder()

    // When: argv is built.
    const argv = builder.buildExecArgv({
      approvalPolicy: 'on-request',
      cwd: '/vault',
      prompt: 'Keep going',
      resume: {
        approvalPolicy: 'on-request',
        cwd: '/vault',
        sandboxMode: 'read-only',
        threadId: 'thread-1',
      },
      sandboxMode: 'workspace-write',
    })

    // Then: the builder starts a fresh exec instead of resuming.
    expect(argv).not.toContain('resume')
    expect(argv).not.toContain('thread-1')
  })
})
