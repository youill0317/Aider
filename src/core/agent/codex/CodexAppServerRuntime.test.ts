import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import type {
  CodexAgentEvent,
  CodexExecRequest,
  CodexPermissionDecision,
  CodexPermissionRequest,
} from '../types'

import { CodexAppServerRuntime } from './CodexAppServerRuntime'

type JsonRpcId = string | number
type WireMessage = {
  readonly id?: JsonRpcId
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: unknown
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  readonly killedSignals: NodeJS.Signals[] = []
  readonly messages: WireMessage[] = []

  private readonly waiters: ((message: WireMessage) => void)[] = []
  private inputBuffer = ''

  constructor() {
    super()
    this.stdin.on('data', (chunk: Buffer | string) => {
      this.inputBuffer += chunk.toString()
      let newline = this.inputBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.inputBuffer.slice(0, newline)
        this.inputBuffer = this.inputBuffer.slice(newline + 1)
        if (line.trim()) {
          this.pushMessage(JSON.parse(line) as WireMessage)
        }
        newline = this.inputBuffer.indexOf('\n')
      }
    })
  }

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killedSignals.push(signal)
    return true
  }

  nextMessage(): Promise<WireMessage> {
    const message = this.messages.shift()
    if (message !== undefined) {
      return Promise.resolve(message)
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  send(message: WireMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  private pushMessage(message: WireMessage): void {
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      waiter(message)
      return
    }
    this.messages.push(message)
  }
}

const BASE_REQUEST: CodexExecRequest = {
  approvalPolicy: 'on-request',
  cwd: '/vault',
  model: 'gpt-5',
  prompt: 'Implement it',
  sandboxMode: 'workspace-write',
}

async function initialize(childProcess: FakeChildProcess): Promise<void> {
  const request = await childProcess.nextMessage()
  expect(request).toMatchObject({
    method: 'initialize',
    params: {
      capabilities: null,
      clientInfo: {
        name: 'aider_obsidian',
        title: 'Aider',
        version: '2.0.7',
      },
    },
  })
  childProcess.send({ id: request.id, result: {} })
  await expect(childProcess.nextMessage()).resolves.toEqual({
    method: 'initialized',
  })
}

async function startTurn(
  childProcess: FakeChildProcess,
  threadId = 'thread-1',
  turnId = 'turn-1',
): Promise<{ threadRequest: WireMessage; turnRequest: WireMessage }> {
  const threadRequest = await childProcess.nextMessage()
  childProcess.send({
    id: threadRequest.id,
    result: { thread: { id: threadId } },
  })
  const turnRequest = await childProcess.nextMessage()
  childProcess.send({
    id: turnRequest.id,
    result: { turn: { id: turnId } },
  })
  return { threadRequest, turnRequest }
}

function completeTurn(
  childProcess: FakeChildProcess,
  threadId = 'thread-1',
  turnId = 'turn-1',
): void {
  childProcess.send({
    method: 'turn/completed',
    params: {
      threadId,
      turn: { id: turnId, status: 'completed' },
    },
  })
}

describe('CodexAppServerRuntime', () => {
  it('reuses one initialized process and normalizes app-server events', async () => {
    const childProcess = new FakeChildProcess()
    const spawned: {
      readonly args: readonly string[]
      readonly command: string
      readonly cwd: string
    }[] = []
    const runtime = new CodexAppServerRuntime({
      spawnSpecResolverOptions: {
        env: { PATH: '/usr/bin' },
        platform: 'linux',
      },
      spawnProcess: (command, args, options) => {
        spawned.push({ args, command, cwd: options.cwd })
        return childProcess
      },
    })
    const events: CodexAgentEvent[] = []

    const first = runtime.execute(BASE_REQUEST, {
      onEvent: (event) => events.push(event),
    })
    await initialize(childProcess)
    childProcess.send({
      method: 'remoteControl/status/changed',
      params: { status: 'disabled' },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(events).not.toContainEqual(
      expect.objectContaining({
        kind: 'unknown',
        type: 'remoteControl/status/changed',
      }),
    )
    const firstStart = await startTurn(childProcess)

    expect(firstStart.threadRequest).toEqual({
      id: expect.any(Number),
      method: 'thread/start',
      params: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        config: { 'sandbox_workspace_write.network_access': false },
        cwd: '/vault',
        model: 'gpt-5',
        sandbox: 'workspace-write',
      },
    })
    expect(firstStart.turnRequest).toEqual({
      id: expect.any(Number),
      method: 'turn/start',
      params: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        cwd: '/vault',
        input: [{ text: 'Implement it', text_elements: [], type: 'text' }],
        model: 'gpt-5',
        sandboxPolicy: {
          excludeSlashTmp: false,
          excludeTmpdirEnvVar: false,
          networkAccess: false,
          type: 'workspaceWrite',
          writableRoots: ['/vault'],
        },
        threadId: 'thread-1',
      },
    })

    childProcess.send({
      method: 'thread/started',
      params: { thread: { id: 'thread-1' }, threadId: 'thread-1' },
    })
    childProcess.send({
      method: 'turn/started',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1' },
        turnId: 'turn-1',
      },
    })
    childProcess.send({
      method: 'item/completed',
      params: {
        item: {
          aggregatedOutput: 'Done',
          exitCode: 0,
          id: 'message-1',
          text: 'Done',
          type: 'agentMessage',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    completeTurn(childProcess)

    await expect(first.done).resolves.toMatchObject({
      status: 'completed',
      threadId: 'thread-1',
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            aggregated_output: 'Done',
            exit_code: 0,
            type: 'agent_message',
          }),
          kind: 'item.completed',
        }),
      ]),
    )

    const second = runtime.execute(
      {
        ...BASE_REQUEST,
        prompt: 'Continue',
        resume: {
          approvalPolicy: 'on-request',
          cwd: '/vault',
          sandboxMode: 'workspace-write',
          threadId: 'thread-1',
        },
      },
      { onEvent: () => undefined },
    )
    const secondStart = await startTurn(childProcess, 'thread-1', 'turn-2')
    expect(secondStart.threadRequest).toMatchObject({
      method: 'thread/resume',
      params: { threadId: 'thread-1' },
    })
    expect(secondStart.turnRequest).toMatchObject({
      method: 'turn/start',
      params: {
        input: [{ text: 'Continue', text_elements: [], type: 'text' }],
        threadId: 'thread-1',
      },
    })
    completeTurn(childProcess, 'thread-1', 'turn-2')
    await expect(second.done).resolves.toMatchObject({ status: 'completed' })

    expect(spawned).toEqual([
      {
        args: ['app-server', '--stdio'],
        command: 'codex',
        cwd: '/vault',
      },
    ])
    runtime.dispose()
  })

  it('answers approval requests with the same id and cleans resolved signals', async () => {
    const childProcess = new FakeChildProcess()
    const decisions: CodexPermissionDecision[] = [
      'accept',
      'decline',
      'acceptForSession',
      'accept',
      'cancel',
    ]
    const permissionRequests: CodexPermissionRequest[] = []
    const runtime = new CodexAppServerRuntime({
      spawnProcess: () => childProcess,
    })
    const handle = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
      onPermissionRequest: async (request) => {
        permissionRequests.push(request)
        return decisions.shift() ?? null
      },
    })
    await initialize(childProcess)
    await startTurn(childProcess)

    childProcess.send({
      id: 71,
      method: 'item/commandExecution/requestApproval',
      params: {
        approvalId: 'approval-1',
        additionalPermissions: {
          fileSystem: { write: ['/outside-vault'] },
          network: { enabled: true },
        },
        availableDecisions: [
          'cancel',
          {
            acceptWithExecpolicyAmendment: {
              execpolicy_amendment: ['npm test'],
            },
          },
          'decline',
        ],
        command: 'npm test',
        itemId: 'command-1',
        networkApprovalContext: {
          host: 'registry.npmjs.org',
          protocol: 'https',
        },
        reason: 'Run tests',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 71,
      result: { decision: 'decline' },
    })
    expect(permissionRequests[0]).toMatchObject({
      details: {
        additionalPermissions: {
          fileSystem: { write: ['/outside-vault'] },
          network: { enabled: true },
        },
        command: 'npm test',
        networkApprovalContext: {
          host: 'registry.npmjs.org',
          protocol: 'https',
        },
      },
      id: '71',
      options: [
        { id: 'cancel', kind: 'cancel', name: 'Cancel turn' },
        { id: 'decline', kind: 'deny', name: 'Deny' },
      ],
      sessionId: 'thread-1',
      title: 'Run tests',
      toolCallId: 'approval-1',
    })
    expect(permissionRequests[0]?.signal.aborted).toBe(false)
    childProcess.send({
      method: 'serverRequest/resolved',
      params: { requestId: 71, threadId: 'thread-1' },
    })
    expect(permissionRequests[0]?.signal.aborted).toBe(true)

    childProcess.send({
      id: 'file-request',
      method: 'item/fileChange/requestApproval',
      params: {
        itemId: 'file-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 'file-request',
      result: { decision: 'decline' },
    })

    childProcess.send({
      id: 73,
      method: 'item/permissions/requestApproval',
      params: {
        itemId: 'permission-1',
        permissions: {
          fileSystem: null,
          network: { enabled: true },
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 73,
      result: {
        permissions: { network: { enabled: true } },
        scope: 'session',
      },
    })

    childProcess.send({
      id: 74,
      method: 'execCommandApproval',
      params: {
        approvalId: null,
        callId: 'legacy-command-1',
        command: ['npm', 'test'],
        conversationId: 'thread-1',
        cwd: '/vault',
        parsedCmd: [],
        reason: null,
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 74,
      result: { decision: 'approved' },
    })
    expect(permissionRequests[3]).toMatchObject({
      sessionId: 'thread-1',
      title: 'npm test',
      toolCallId: 'legacy-command-1',
    })

    childProcess.send({
      id: 75,
      method: 'applyPatchApproval',
      params: {
        callId: 'legacy-patch-1',
        conversationId: 'thread-1',
        fileChanges: {},
        grantRoot: null,
        reason: null,
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 75,
      result: { decision: 'abort' },
    })

    completeTurn(childProcess)
    await expect(handle.done).resolves.toMatchObject({ status: 'completed' })
    expect(permissionRequests[1]?.signal.aborted).toBe(true)
    expect(permissionRequests[2]?.signal.aborted).toBe(true)
    runtime.dispose()
  })

  it('interrupts an aborted turn and ignores a late approval decision', async () => {
    const childProcess = new FakeChildProcess()
    let permissionRequest: CodexPermissionRequest | undefined
    let permissionCalls = 0
    let resolveDecision!: (decision: CodexPermissionDecision) => void
    const decision = new Promise<CodexPermissionDecision>((resolve) => {
      resolveDecision = resolve
    })
    const runtime = new CodexAppServerRuntime({
      spawnProcess: () => childProcess,
    })
    const handle = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
      onPermissionRequest: async (request) => {
        permissionCalls += 1
        permissionRequest = request
        return decision
      },
    })
    await initialize(childProcess)
    await startTurn(childProcess)

    childProcess.send({
      id: 81,
      method: 'item/commandExecution/requestApproval',
      params: {
        itemId: 'command-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    await Promise.resolve()
    expect(permissionRequest?.signal.aborted).toBe(false)

    handle.abort()
    expect(permissionRequest?.signal.aborted).toBe(true)
    const interrupt = await childProcess.nextMessage()
    expect(interrupt).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    })
    childProcess.send({
      id: 82,
      method: 'item/commandExecution/requestApproval',
      params: {
        itemId: 'late-command',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    })
    await expect(childProcess.nextMessage()).resolves.toEqual({
      id: 82,
      result: { decision: 'decline' },
    })
    expect(permissionCalls).toBe(1)
    childProcess.send({ id: interrupt.id, result: {} })
    childProcess.send({
      method: 'serverRequest/resolved',
      params: { requestId: 81, threadId: 'thread-1' },
    })
    childProcess.send({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'interrupted' },
      },
    })
    await expect(handle.done).resolves.toMatchObject({ status: 'cancelled' })

    resolveDecision('accept')
    await Promise.resolve()
    await Promise.resolve()
    expect(childProcess.messages).not.toContainEqual(
      expect.objectContaining({ id: 81 }),
    )
    runtime.dispose()
  })

  it('keeps an aborted startup isolated until its RPC settles', async () => {
    const childProcess = new FakeChildProcess()
    const runtime = new CodexAppServerRuntime({
      spawnProcess: () => childProcess,
    })
    const first = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
    })
    await initialize(childProcess)
    const firstThreadRequest = await childProcess.nextMessage()

    first.abort()
    expect(() =>
      runtime.execute(
        { ...BASE_REQUEST, prompt: 'Do not overlap' },
        { onEvent: () => undefined },
      ),
    ).toThrow('Another Codex app-server turn is already active.')

    childProcess.send({
      id: firstThreadRequest.id,
      result: { thread: { id: 'thread-old' } },
    })
    await expect(first.done).resolves.toMatchObject({ status: 'cancelled' })

    const events: CodexAgentEvent[] = []
    const second = runtime.execute(
      { ...BASE_REQUEST, prompt: 'Start cleanly' },
      { onEvent: (event) => events.push(event) },
    )
    const secondThreadRequest = await childProcess.nextMessage()
    childProcess.send({
      method: 'thread/started',
      params: { thread: { id: 'thread-old' }, threadId: 'thread-old' },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(events).toEqual([])

    childProcess.send({
      id: secondThreadRequest.id,
      result: { thread: { id: 'thread-new' } },
    })
    const secondTurnRequest = await childProcess.nextMessage()
    childProcess.send({
      id: secondTurnRequest.id,
      result: { turn: { id: 'turn-new' } },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    completeTurn(childProcess, 'thread-new', 'turn-new')
    await expect(second.done).resolves.toMatchObject({
      status: 'completed',
      threadId: 'thread-new',
    })
    runtime.dispose()
  })

  it('kills a turn that does not complete after interruption', async () => {
    const childProcess = new FakeChildProcess()
    const runtime = new CodexAppServerRuntime({
      interruptTimeoutMs: 5,
      spawnProcess: () => childProcess,
    })
    const handle = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
    })
    await initialize(childProcess)
    await startTurn(childProcess)

    handle.abort()
    await expect(childProcess.nextMessage()).resolves.toMatchObject({
      method: 'turn/interrupt',
    })
    await expect(handle.done).resolves.toMatchObject({ status: 'cancelled' })
    expect(childProcess.killedSignals).toEqual(['SIGTERM'])
    runtime.dispose()
  })

  it('fails safely when the app-server stdin stream errors', async () => {
    const childProcess = new FakeChildProcess()
    const runtime = new CodexAppServerRuntime({
      spawnProcess: () => childProcess,
    })
    const handle = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
    })
    await childProcess.nextMessage()
    const failure = expect(handle.done).rejects.toThrow('write EPIPE')

    childProcess.stdin.emit('error', new Error('write EPIPE'))

    await failure
    expect(childProcess.killedSignals).toEqual(['SIGTERM'])
    runtime.dispose()
  })

  it('rejects an oversized JSONL line with bounded stderr context', async () => {
    const childProcess = new FakeChildProcess()
    const runtime = new CodexAppServerRuntime({
      maxJsonlLineChars: 16,
      maxStderrBytes: 8,
      spawnProcess: () => childProcess,
    })
    const handle = runtime.execute(BASE_REQUEST, {
      onEvent: () => undefined,
    })
    await childProcess.nextMessage()

    childProcess.stderr.write('0123456789')
    childProcess.stdout.write('x'.repeat(17))

    await expect(handle.done).rejects.toThrow(
      'JSONL line exceeded 16 characters.: 23456789',
    )
    expect(childProcess.killedSignals).toEqual(['SIGTERM'])
    runtime.dispose()
  })
})
