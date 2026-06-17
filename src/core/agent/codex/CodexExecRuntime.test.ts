import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import type { CodexAgentEvent } from '../types'

import { CodexExecRuntime } from './CodexExecRuntime'

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  readonly killedSignals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killedSignals.push(signal)
    return true
  }

  close(exitCode: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('close', exitCode, signal)
  }
}

describe('CodexExecRuntime', () => {
  it('streams parsed Codex events and resolves successful runs', async () => {
    // Given: a fake Codex process emits JSONL on stdout.
    const childProcess = new FakeChildProcess()
    const spawned: {
      command: string
      args: readonly string[]
      cwd: string
      env: NodeJS.ProcessEnv
      stdio: readonly ['pipe', 'pipe', 'pipe']
    }[] = []
    const runtime = new CodexExecRuntime({
      spawnSpecResolverOptions: {
        env: { PATH: '/usr/bin' },
        platform: 'linux',
      },
      spawnProcess: (command, args, options) => {
        spawned.push({
          args,
          command,
          cwd: options.cwd,
          env: options.env,
          stdio: options.stdio,
        })
        return childProcess
      },
    })
    const events: CodexAgentEvent[] = []

    // When: the run emits a thread id and exits cleanly.
    const handle = runtime.execute(
      {
        cwd: '/vault',
        prompt: 'Implement it',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'default',
      },
      { onEvent: (event) => events.push(event) },
    )
    childProcess.stdout.write(
      '{"type":"thread.started","thread_id":"thread-1"}\n',
    )
    childProcess.stdout.write('{"type":"turn.completed","turn_id":"turn-1"}\n')
    childProcess.close(0)

    // Then: the runtime reports command details, events, and thread id.
    await expect(handle.done).resolves.toMatchObject({
      status: 'completed',
      threadId: 'thread-1',
    })
    expect(spawned).toEqual([
      {
        args: [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--cd',
          '/vault',
          '--sandbox',
          'workspace-write',
        ],
        command: 'codex',
        cwd: '/vault',
        env: expect.objectContaining({
          PATH: expect.stringContaining('/usr/bin'),
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ])
    expect(childProcess.stdin.read()?.toString()).toBe('Implement it')
    expect(childProcess.stdin.writableEnded).toBe(true)
    expect(events.map((event) => event.kind)).toEqual([
      'thread.started',
      'turn.completed',
    ])
  })

  it('cancels the child process when aborted', async () => {
    // Given: a running Codex process.
    const childProcess = new FakeChildProcess()
    const runtime = new CodexExecRuntime({
      spawnProcess: () => childProcess,
    })

    // When: the caller aborts the run.
    const handle = runtime.execute(
      {
        cwd: '/vault',
        prompt: 'Stop',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'default',
      },
      { onEvent: () => undefined },
    )
    handle.abort()
    childProcess.close(null, 'SIGTERM')

    // Then: the process receives SIGTERM and the run is cancelled.
    await expect(handle.done).resolves.toMatchObject({
      signal: 'SIGTERM',
      status: 'cancelled',
    })
    expect(childProcess.killedSignals).toEqual(['SIGTERM'])
  })

  it('escalates aborted processes that do not close after SIGTERM', async () => {
    jest.useFakeTimers()
    try {
      // Given: a running process that ignores SIGTERM.
      const childProcess = new FakeChildProcess()
      const runtime = new CodexExecRuntime({
        killTimeoutMs: 100,
        spawnProcess: () => childProcess,
      })

      // When: the caller aborts and the process does not close promptly.
      const handle = runtime.execute(
        {
          cwd: '/vault',
          prompt: 'Stop',
          sandboxMode: 'workspace-write',
          approvalPolicy: 'default',
        },
        { onEvent: () => undefined },
      )
      handle.abort()
      jest.advanceTimersByTime(100)
      childProcess.close(null, 'SIGKILL')

      // Then: SIGKILL is used as a cleanup fallback.
      await expect(handle.done).resolves.toMatchObject({
        signal: 'SIGKILL',
        status: 'cancelled',
      })
      expect(childProcess.killedSignals).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects failed Codex turns with bounded stderr context', async () => {
    // Given: Codex reports a failed turn and emits a long stderr stream.
    const childProcess = new FakeChildProcess()
    const runtime = new CodexExecRuntime({
      maxStderrBytes: 12,
      spawnProcess: () => childProcess,
    })

    // When: the process exits cleanly after the failed turn event.
    const handle = runtime.execute(
      {
        cwd: '/vault',
        prompt: 'Fail',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'default',
      },
      { onEvent: () => undefined },
    )
    childProcess.stderr.write('0123456789abcdef')
    childProcess.stdout.write('{"type":"turn.failed"}\n')
    childProcess.close(0)

    // Then: the run rejects instead of being stored as completed.
    await expect(handle.done).rejects.toThrow('Codex turn failed')
  })

  it('rejects malformed JSONL and terminates the process', async () => {
    // Given: a Codex process that emits invalid JSON.
    const childProcess = new FakeChildProcess()
    const errors: Error[] = []
    const runtime = new CodexExecRuntime({
      spawnProcess: () => childProcess,
    })

    // When: invalid JSONL arrives.
    const handle = runtime.execute(
      {
        cwd: '/vault',
        prompt: 'Bad output',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'default',
      },
      {
        onError: (error) => errors.push(error),
        onEvent: () => undefined,
      },
    )
    childProcess.stdout.write('{bad json}\n')

    // Then: the runtime rejects and asks the process to stop.
    await expect(handle.done).rejects.toThrow('Malformed Codex JSONL at line 1')
    expect(errors[0]?.message).toContain('Malformed Codex JSONL at line 1')
    expect(childProcess.killedSignals).toEqual(['SIGTERM'])
  })
})
