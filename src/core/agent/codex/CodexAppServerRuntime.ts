import { version as pluginVersion } from '../../../../manifest.json'
import {
  redactEnvironmentSecrets,
  redactSecrets,
} from '../../../utils/security/redact-secrets'
import type {
  CodexAgentEvent,
  CodexExecRequest,
  CodexPermissionDecision,
  CodexPermissionOption,
  CodexRunHandle,
  CodexRunResult,
  CodexRuntime,
  CodexRuntimeHandlers,
} from '../types'

import {
  CodexSpawnSpecResolver,
  type CodexSpawnSpecResolverOptions,
  buildWindowsSpawnOptions,
} from './CodexSpawnSpecResolver'

const CLIENT_INFO = {
  name: 'aider_obsidian',
  title: 'Aider',
  version: pluginVersion,
} as const
const DEFAULT_CODEX_COMMAND = 'codex'
const MAX_EVENT_STRING_CHARS = 24_000
const SAFE_THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const DISABLE_NETWORK_CONFIG = 'sandbox_workspace_write.network_access'

type JsonRpcId = string | number
type JsonObject = Record<string, unknown>

type CodexSpawnOptions = {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly shell: false
  readonly stdio: readonly ['pipe', 'pipe', 'pipe']
  readonly windowsHide?: boolean
  readonly windowsVerbatimArguments?: boolean
}

type CodexChildProcess = {
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  readonly stdin: NodeJS.WritableStream | null
  kill: (signal?: NodeJS.Signals) => boolean
  on: {
    (
      event: 'close',
      listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): CodexChildProcess
    (event: 'error', listener: (error: Error) => void): CodexChildProcess
  }
}

type CodexSpawn = (
  command: string,
  args: readonly string[],
  options: CodexSpawnOptions,
) => CodexChildProcess

export type CodexAppServerRuntimeOptions = {
  readonly interruptTimeoutMs?: number
  readonly maxJsonlLineChars?: number
  readonly maxStderrChars?: number
  readonly spawnProcess: CodexSpawn
  readonly spawnSpecResolver?: CodexSpawnSpecResolver
  readonly spawnSpecResolverOptions?: CodexSpawnSpecResolverOptions
}

type PendingRpc = {
  readonly method: string
  readonly reject: (error: Error) => void
  readonly resolve: (result: unknown) => void
}

type ActiveRun = {
  readonly handlers: CodexRuntimeHandlers
  readonly request: CodexExecRequest
  readonly resolve: (result: CodexRunResult) => void
  readonly reject: (error: Error) => void
  abortRequested: boolean
  finished: boolean
  interruptTimer: ReturnType<typeof setTimeout> | null
  interruptSent: boolean
  threadId: string | null
  turnId: string | null
  turnStartSent: boolean
}

type PendingApproval = {
  readonly controller: AbortController
  readonly run: ActiveRun
  responded: boolean
}

const PERMISSION_OPTIONS: readonly CodexPermissionOption[] = [
  { id: 'accept', kind: 'allow', name: 'Allow once' },
  {
    id: 'acceptForSession',
    kind: 'allow',
    name: 'Allow for session',
  },
  { id: 'decline', kind: 'deny', name: 'Deny' },
  { id: 'cancel', kind: 'cancel', name: 'Cancel turn' },
]

export class CodexAppServerRuntime implements CodexRuntime {
  private readonly interruptTimeoutMs: number
  private readonly maxJsonlLineChars: number
  private readonly maxStderrChars: number
  private readonly spawnProcess: CodexSpawn
  private readonly spawnSpecResolver: CodexSpawnSpecResolver
  private readonly spawnSpecResolverOptions: CodexSpawnSpecResolverOptions
  private readonly pendingApprovals = new Map<JsonRpcId, PendingApproval>()
  private readonly pendingRpcs = new Map<JsonRpcId, PendingRpc>()

  private activeRun: ActiveRun | null = null
  private childProcess: CodexChildProcess | null = null
  private connectionPromise: Promise<void> | null = null
  private disposed = false
  private line = 0
  private nextRequestId = 1
  private processKey: string | null = null
  private stderr = ''
  private stdoutBuffer = ''

  constructor({
    interruptTimeoutMs = 2_000,
    maxJsonlLineChars = 1_000_000,
    maxStderrChars = 8192,
    spawnProcess,
    spawnSpecResolver = new CodexSpawnSpecResolver(),
    spawnSpecResolverOptions = {},
  }: CodexAppServerRuntimeOptions) {
    this.interruptTimeoutMs = interruptTimeoutMs
    this.maxJsonlLineChars = maxJsonlLineChars
    this.maxStderrChars = maxStderrChars
    this.spawnProcess = spawnProcess
    this.spawnSpecResolver = spawnSpecResolver
    this.spawnSpecResolverOptions = spawnSpecResolverOptions
  }

  execute(
    request: CodexExecRequest,
    handlers: CodexRuntimeHandlers,
  ): CodexRunHandle {
    if (this.disposed) {
      throw new Error('Codex app-server runtime is disposed.')
    }
    if (this.activeRun !== null) {
      throw new Error('Another Codex app-server turn is already active.')
    }
    this.stderr = ''

    let resolveRun!: (result: CodexRunResult) => void
    let rejectRun!: (error: Error) => void
    const done = new Promise<CodexRunResult>((resolve, reject) => {
      resolveRun = resolve
      rejectRun = reject
    })
    const run: ActiveRun = {
      abortRequested: false,
      finished: false,
      handlers,
      interruptTimer: null,
      interruptSent: false,
      reject: rejectRun,
      request,
      resolve: resolveRun,
      threadId: null,
      turnId: null,
      turnStartSent: false,
    }
    this.activeRun = run
    void this.startRun(run)

    return {
      done,
      abort: () => this.abortRun(run),
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const childProcess = this.childProcess
    this.resetConnection(childProcess)
    this.rejectPendingRpcs(new Error('Codex app-server runtime was disposed.'))
    this.abortPendingApprovals()
    if (this.activeRun !== null) {
      this.finishRun(this.activeRun, 'cancelled')
    }
    childProcess?.stdin?.end()
    childProcess?.kill('SIGTERM')
  }

  private async startRun(run: ActiveRun): Promise<void> {
    try {
      await this.ensureConnection(run.request)
      if (run.finished) {
        return
      }
      if (run.abortRequested) {
        this.finishRun(run, 'cancelled')
        return
      }

      const resume = matchingResume(run.request)
      const threadResponse = asObject(
        await this.request(
          resume ? 'thread/resume' : 'thread/start',
          resume
            ? {
                ...buildThreadParams(run.request),
                threadId: resume.threadId,
              }
            : buildThreadParams(run.request),
        ),
        'thread response',
      )
      const thread = asObject(threadResponse.thread, 'thread')
      const threadId = requiredString(thread.id, 'thread.id')
      if (run.threadId !== null && run.threadId !== threadId) {
        throw new Error('Codex app-server returned a mismatched thread id.')
      }
      run.threadId = threadId

      if (run.finished) {
        return
      }
      if (run.abortRequested) {
        this.finishRun(run, 'cancelled')
        return
      }

      run.turnStartSent = true
      const turnResponse = asObject(
        await this.request('turn/start', {
          approvalPolicy: run.request.approvalPolicy,
          approvalsReviewer: 'user',
          cwd: run.request.cwd,
          input: [
            { text: run.request.prompt, text_elements: [], type: 'text' },
          ],
          model: normalizedModel(run.request.model),
          sandboxPolicy: buildSandboxPolicy(run.request),
          threadId,
        }),
        'turn/start response',
      )
      const turn = asObject(turnResponse.turn, 'turn')
      const turnId = requiredString(turn.id, 'turn.id')
      if (run.turnId !== null && run.turnId !== turnId) {
        throw new Error('Codex app-server returned a mismatched turn id.')
      }
      run.turnId = turnId

      if (run.finished) {
        return
      }
      if (run.abortRequested) {
        this.interruptRun(run)
      }
    } catch (error) {
      if (!run.finished) {
        this.finishRun(run, run.abortRequested ? 'cancelled' : 'failed', error)
      }
    }
  }

  private async ensureConnection(request: CodexExecRequest): Promise<void> {
    const requestedCommand =
      nonEmptyTrimmed(request.command) ?? DEFAULT_CODEX_COMMAND
    const spawnSpec = this.spawnSpecResolver.resolve(
      [requestedCommand, 'app-server', '--stdio'],
      this.spawnSpecResolverOptions,
    )
    const processKey = JSON.stringify([spawnSpec.command, spawnSpec.args])

    if (this.connectionPromise !== null) {
      if (this.processKey !== processKey) {
        throw new Error(
          'Codex command changed while the app-server runtime was active.',
        )
      }
      return this.connectionPromise
    }

    const childProcess = this.spawnProcess(spawnSpec.command, spawnSpec.args, {
      cwd: request.cwd,
      env: spawnSpec.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...buildWindowsSpawnOptions(spawnSpec),
    })
    this.childProcess = childProcess
    this.processKey = processKey
    this.stderr = ''
    this.stdoutBuffer = ''

    childProcess.stdout?.on('data', (chunk: Buffer | string) => {
      if (this.childProcess === childProcess) {
        this.consumeStdout(chunk.toString(), childProcess)
      }
    })
    childProcess.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.childProcess === childProcess) {
        this.stderr = appendBounded(
          this.stderr,
          chunk.toString(),
          this.maxStderrChars,
        )
      }
    })
    childProcess.stdin?.on('error', (error: Error) => {
      this.breakConnection(childProcess, error)
    })
    childProcess.stdout?.on('error', (error: Error) => {
      this.breakConnection(childProcess, error)
    })
    childProcess.stderr?.on('error', (error: Error) => {
      this.breakConnection(childProcess, error)
    })
    childProcess.on('error', (error) => {
      this.breakConnection(childProcess, error)
    })
    childProcess.on('close', (exitCode, signal) => {
      if (this.childProcess !== childProcess) {
        return
      }
      const suffix =
        signal !== null
          ? ` by ${signal}`
          : exitCode === null
            ? ''
            : ` with code ${exitCode}`
      this.breakConnection(
        childProcess,
        new Error(`Codex app-server exited${suffix}.`),
      )
    })

    const connectionPromise = (async () => {
      await this.request('initialize', {
        capabilities: null,
        clientInfo: CLIENT_INFO,
      })
      this.notify('initialized')
    })()
    this.connectionPromise = connectionPromise

    try {
      await connectionPromise
    } catch (error) {
      this.breakConnection(childProcess, error)
      throw error
    }
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      this.pendingRpcs.set(id, { method, reject, resolve })
      try {
        this.write({ id, method, params })
      } catch (error) {
        this.pendingRpcs.delete(id)
        reject(normalizeError(error))
      }
    })
  }

  private notify(method: string, params?: JsonObject): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  private write(message: JsonObject): void {
    const stdin = this.childProcess?.stdin
    if (stdin === null || stdin === undefined) {
      throw new Error('Codex app-server stdin is unavailable.')
    }
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  private consumeStdout(chunk: string, childProcess: CodexChildProcess): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')

    try {
      while (newline >= 0) {
        const rawLine = this.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
        this.parseLine(rawLine)
        newline = this.stdoutBuffer.indexOf('\n')
      }
      if (this.stdoutBuffer.length > this.maxJsonlLineChars) {
        throw new Error(
          `Codex app-server JSONL line exceeded ${this.maxJsonlLineChars} characters.`,
        )
      }
    } catch (error) {
      this.breakConnection(childProcess, error)
    }
  }

  private parseLine(rawLine: string): void {
    const line = rawLine.trim()
    if (line.length === 0) {
      return
    }
    if (line.length > this.maxJsonlLineChars) {
      throw new Error(
        `Codex app-server JSONL line exceeded ${this.maxJsonlLineChars} characters.`,
      )
    }

    this.line += 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`Invalid Codex app-server JSONL at line ${this.line}.`)
    }
    const message = asObject(parsed, `JSONL line ${this.line}`)
    const method = typeof message.method === 'string' ? message.method : null
    const hasId =
      typeof message.id === 'string' || typeof message.id === 'number'

    if (
      hasId &&
      ('result' in message || 'error' in message) &&
      method === null
    ) {
      this.handleResponse(message.id as JsonRpcId, message)
      return
    }
    if (method !== null && hasId) {
      this.handleServerRequest(
        method,
        message.id as JsonRpcId,
        optionalObject(message.params),
      )
      return
    }
    if (method !== null) {
      this.handleNotification(method, optionalObject(message.params))
      return
    }
    throw new Error(`Invalid Codex app-server message at line ${this.line}.`)
  }

  private handleResponse(id: JsonRpcId, message: JsonObject): void {
    const pending = this.pendingRpcs.get(id)
    if (pending === undefined) {
      return
    }
    this.pendingRpcs.delete(id)

    if ('error' in message) {
      const error = optionalObject(message.error)
      const detail =
        typeof error.message === 'string'
          ? error.message
          : 'Unknown JSON-RPC error'
      pending.reject(
        new Error(`Codex app-server ${pending.method} failed: ${detail}`),
      )
      return
    }
    pending.resolve(message.result)
  }

  private handleServerRequest(
    method: string,
    id: JsonRpcId,
    params: JsonObject,
  ): void {
    if (
      method !== 'item/commandExecution/requestApproval' &&
      method !== 'item/fileChange/requestApproval' &&
      method !== 'item/permissions/requestApproval' &&
      method !== 'execCommandApproval' &&
      method !== 'applyPatchApproval'
    ) {
      this.write({
        error: {
          code: -32000,
          message: `Unsupported app-server request: ${method}`,
        },
        id,
      })
      return
    }

    const run = this.activeRun
    if (
      run === null ||
      run.finished ||
      run.abortRequested ||
      !requestBelongsToRun(method, params, run)
    ) {
      this.write({
        id,
        result: deniedApprovalResult(method),
      })
      return
    }

    const previous = this.pendingApprovals.get(id)
    previous?.controller.abort()
    const pending: PendingApproval = {
      controller: new AbortController(),
      responded: false,
      run,
    }
    this.pendingApprovals.set(id, pending)
    const env = this.spawnSpecResolverOptions.env ?? process.env
    const options = approvalOptions(method, params)

    const handler = run.handlers.onPermissionRequest
    void Promise.resolve()
      .then(() =>
        handler && options.length > 0
          ? handler({
              details: sanitizeEventValue(
                redactSecrets(approvalDetails(method, params)),
                env,
              ) as JsonObject,
              id: String(id),
              options,
              sessionId: approvalSessionId(method, params),
              signal: pending.controller.signal,
              title: sanitizeEventValue(
                redactSecrets(approvalTitle(method, params)),
                env,
              ) as string,
              toolCallId: approvalToolCallId(params, id),
            })
          : 'decline',
      )
      .then((choice) => {
        if (
          pending.controller.signal.aborted ||
          this.pendingApprovals.get(id) !== pending ||
          pending.responded
        ) {
          return
        }
        const decision = allowedPermissionDecision(choice, options)
        if (
          !this.writeApprovalResponse({
            id,
            result: approvalResult(method, params, decision),
          })
        ) {
          return
        }
        pending.responded = true
        if (
          method === 'item/permissions/requestApproval' &&
          decision === 'cancel'
        ) {
          this.abortRun(run)
        }
      })
      .catch((error) => {
        if (
          pending.controller.signal.aborted ||
          this.pendingApprovals.get(id) !== pending ||
          pending.responded
        ) {
          return
        }
        this.reportHandlerError(run, error)
        pending.responded = true
        this.writeApprovalResponse({
          id,
          result: deniedApprovalResult(method),
        })
      })
  }

  private writeApprovalResponse(message: JsonObject): boolean {
    const childProcess = this.childProcess
    try {
      this.write(message)
      return true
    } catch (error) {
      if (childProcess !== null) {
        this.breakConnection(childProcess, error)
      }
      return false
    }
  }

  private handleNotification(method: string, params: JsonObject): void {
    if (method === 'serverRequest/resolved') {
      const requestId = params.requestId
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        this.resolveApproval(requestId)
      }
      return
    }

    const run = this.activeRun
    if (run === null || !notificationBelongsToRun(params, run)) {
      return
    }

    switch (method) {
      case 'thread/started': {
        const thread = asObject(params.thread, 'thread/started.thread')
        const threadId = requiredString(thread.id, 'thread.id')
        if (run.threadId !== null && run.threadId !== threadId) {
          return
        }
        run.threadId = threadId
        this.emit(run, {
          kind: 'thread.started',
          line: this.line,
          threadId,
        })
        return
      }
      case 'turn/started': {
        const turn = asObject(params.turn, 'turn/started.turn')
        const turnId = requiredString(turn.id, 'turn.id')
        if (run.turnId !== null && run.turnId !== turnId) {
          return
        }
        run.turnId = turnId
        this.emit(run, {
          kind: 'turn.started',
          line: this.line,
          turnId,
        })
        if (run.abortRequested) {
          this.interruptRun(run)
        }
        return
      }
      case 'item/started':
      case 'item/completed': {
        const item = normalizeItem(asObject(params.item, `${method}.item`))
        this.emit(run, {
          item,
          kind: method === 'item/started' ? 'item.started' : 'item.completed',
          line: this.line,
        })
        return
      }
      case 'turn/completed': {
        const turn = asObject(params.turn, 'turn/completed.turn')
        const turnId = requiredString(turn.id, 'turn.id')
        if (run.turnId !== null && run.turnId !== turnId) {
          return
        }
        run.turnId = turnId
        const status = requiredString(turn.status, 'turn.status')
        this.emit(run, {
          kind: status === 'failed' ? 'turn.failed' : 'turn.completed',
          line: this.line,
          turnId,
        })
        if (status === 'failed') {
          const turnError = optionalObject(turn.error)
          this.finishRun(
            run,
            'failed',
            new Error(
              typeof turnError.message === 'string'
                ? turnError.message
                : 'Codex turn failed.',
            ),
          )
        } else {
          this.finishRun(
            run,
            status === 'interrupted' ? 'cancelled' : 'completed',
          )
        }
        return
      }
      case 'error': {
        const error = optionalObject(params.error)
        const message =
          typeof error.message === 'string'
            ? error.message
            : 'Codex app-server error'
        const code =
          typeof error.codexErrorInfo === 'string'
            ? error.codexErrorInfo
            : undefined
        this.emit(run, {
          ...(code ? { code } : {}),
          kind: 'error',
          line: this.line,
          message,
        })
        return
      }
      default:
        this.emit(run, {
          kind: 'unknown',
          line: this.line,
          payload: params,
          type: method,
        })
    }
  }

  private emit(run: ActiveRun, event: CodexAgentEvent): void {
    const env = this.spawnSpecResolverOptions.env ?? process.env
    run.handlers.onEvent(sanitizeEvent(event, env))
  }

  private abortRun(run: ActiveRun): void {
    if (run.finished || run.abortRequested) {
      return
    }
    run.abortRequested = true
    this.abortPendingApprovals(run)
    const childProcess = this.childProcess
    run.interruptTimer = setTimeout(() => {
      if (!run.finished && childProcess !== null) {
        this.breakConnection(
          childProcess,
          new Error('Codex turn interrupt timed out.'),
        )
      }
    }, this.interruptTimeoutMs)

    if (!run.turnStartSent) {
      return
    }
    if (run.threadId !== null && run.turnId !== null) {
      this.interruptRun(run)
    }
  }

  private interruptRun(run: ActiveRun): void {
    if (
      run.finished ||
      run.interruptSent ||
      run.threadId === null ||
      run.turnId === null
    ) {
      return
    }
    run.interruptSent = true
    const childProcess = this.childProcess
    void this.request('turn/interrupt', {
      threadId: run.threadId,
      turnId: run.turnId,
    }).catch((error) => {
      if (childProcess !== null) {
        this.breakConnection(childProcess, error)
      }
    })
  }

  private resolveApproval(id: JsonRpcId): void {
    const pending = this.pendingApprovals.get(id)
    if (pending === undefined) {
      return
    }
    this.pendingApprovals.delete(id)
    pending.controller.abort()
  }

  private abortPendingApprovals(run?: ActiveRun): void {
    for (const [id, pending] of this.pendingApprovals) {
      if (run === undefined || pending.run === run) {
        this.pendingApprovals.delete(id)
        pending.controller.abort()
      }
    }
  }

  private reportHandlerError(run: ActiveRun, error: unknown): void {
    const env = this.spawnSpecResolverOptions.env ?? process.env
    const safeError = sanitizeError(error, env)
    try {
      run.handlers.onError?.(safeError)
    } catch {
      // A UI error callback must not strand the server-side approval request.
    }
  }

  private finishRun(
    run: ActiveRun,
    status: CodexRunResult['status'],
    error?: unknown,
  ): void {
    if (run.finished) {
      return
    }
    run.finished = true
    if (run.interruptTimer !== null) {
      clearTimeout(run.interruptTimer)
      run.interruptTimer = null
    }
    this.abortPendingApprovals(run)
    if (this.activeRun === run) {
      this.activeRun = null
    }

    const env = this.spawnSpecResolverOptions.env ?? process.env
    const safeStderr = redactEnvironmentSecrets(this.stderr, env)
    if (status === 'failed') {
      const safeError = sanitizeError(error, env)
      const failure = new Error(
        `${safeError.message}${safeStderr ? `: ${safeStderr}` : ''}`.slice(
          0,
          MAX_EVENT_STRING_CHARS,
        ),
      )
      failure.name = safeError.name
      try {
        run.handlers.onError?.(failure)
      } catch {
        // Preserve the runtime result even when a UI callback fails.
      }
      run.reject(failure)
      return
    }

    run.resolve({
      exitCode: null,
      signal: null,
      status,
      stderr: safeStderr,
      threadId: run.threadId,
    })
  }

  private breakConnection(
    childProcess: CodexChildProcess,
    error: unknown,
  ): void {
    if (this.childProcess !== childProcess) {
      return
    }
    const normalized = normalizeError(error)
    this.resetConnection(childProcess)
    this.rejectPendingRpcs(normalized)
    this.abortPendingApprovals()
    childProcess.kill('SIGTERM')

    const run = this.activeRun
    if (run !== null) {
      this.finishRun(
        run,
        run.abortRequested || this.disposed ? 'cancelled' : 'failed',
        normalized,
      )
    }
  }

  private resetConnection(childProcess: CodexChildProcess | null): void {
    if (childProcess !== null && this.childProcess !== childProcess) {
      return
    }
    this.childProcess = null
    this.connectionPromise = null
    this.processKey = null
    this.stdoutBuffer = ''
  }

  private rejectPendingRpcs(error: Error): void {
    for (const pending of this.pendingRpcs.values()) {
      pending.reject(error)
    }
    this.pendingRpcs.clear()
  }
}

function buildThreadParams(request: CodexExecRequest): JsonObject {
  return {
    approvalPolicy: request.approvalPolicy,
    approvalsReviewer: 'user',
    config: { [DISABLE_NETWORK_CONFIG]: false },
    cwd: request.cwd,
    model: normalizedModel(request.model),
    sandbox: request.sandboxMode,
  }
}

function buildSandboxPolicy(request: CodexExecRequest): JsonObject {
  switch (request.sandboxMode) {
    case 'read-only':
      return { networkAccess: false, type: 'readOnly' }
    case 'workspace-write':
      return {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        type: 'workspaceWrite',
        writableRoots: [request.cwd],
      }
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
  }
}

function matchingResume(request: CodexExecRequest): CodexExecRequest['resume'] {
  const resume = request.resume
  if (
    resume === undefined ||
    resume.cwd !== request.cwd ||
    resume.sandboxMode !== request.sandboxMode ||
    resume.approvalPolicy !== request.approvalPolicy
  ) {
    return undefined
  }
  if (!SAFE_THREAD_ID_PATTERN.test(resume.threadId)) {
    throw new Error(`Unsafe Codex thread id: ${resume.threadId}`)
  }
  return resume
}

function normalizedModel(model: string | undefined): string | null {
  return nonEmptyTrimmed(model)
}

function nonEmptyTrimmed(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function requestBelongsToRun(
  method: string,
  params: JsonObject,
  run: ActiveRun,
): boolean {
  if (isLegacyApprovalMethod(method)) {
    return (
      run.threadId !== null &&
      typeof params.conversationId === 'string' &&
      params.conversationId === run.threadId
    )
  }
  return (
    run.threadId !== null &&
    run.turnId !== null &&
    typeof params.threadId === 'string' &&
    typeof params.turnId === 'string' &&
    params.threadId === run.threadId &&
    params.turnId === run.turnId
  )
}

function notificationBelongsToRun(params: JsonObject, run: ActiveRun): boolean {
  const threadId =
    typeof params.threadId === 'string'
      ? params.threadId
      : optionalObject(params.thread).id
  const turnId =
    typeof params.turnId === 'string'
      ? params.turnId
      : optionalObject(params.turn).id
  if (typeof threadId !== 'string' && typeof turnId !== 'string') {
    return false
  }
  return (
    (typeof threadId !== 'string' ||
      (run.threadId !== null && threadId === run.threadId)) &&
    (typeof turnId !== 'string' ||
      (run.turnId !== null && turnId === run.turnId))
  )
}

function approvalTitle(method: string, params: JsonObject): string {
  if (typeof params.reason === 'string' && params.reason.trim()) {
    return params.reason
  }
  if (
    (method === 'item/commandExecution/requestApproval' ||
      method === 'execCommandApproval') &&
    ((typeof params.command === 'string' && params.command.trim()) ||
      (Array.isArray(params.command) && params.command.length > 0))
  ) {
    return Array.isArray(params.command)
      ? params.command.map(String).join(' ')
      : String(params.command)
  }
  if (
    method === 'item/fileChange/requestApproval' ||
    method === 'applyPatchApproval'
  ) {
    return 'Approve file changes?'
  }
  return 'Approve requested permissions?'
}

function approvalDetails(method: string, params: JsonObject): JsonObject {
  const details: JsonObject = {}
  const command = params.command
  if (typeof command === 'string') {
    details.command = command
  } else if (Array.isArray(command)) {
    details.command = command.map(String).join(' ')
  }
  if (typeof params.cwd === 'string') {
    details.workingDirectory = params.cwd
  }
  if (typeof params.grantRoot === 'string') {
    details.writableRoot = params.grantRoot
  }
  if (
    params.additionalPermissions !== null &&
    typeof params.additionalPermissions === 'object' &&
    !Array.isArray(params.additionalPermissions)
  ) {
    details.additionalPermissions = params.additionalPermissions
  }
  if (
    params.networkApprovalContext !== null &&
    typeof params.networkApprovalContext === 'object' &&
    !Array.isArray(params.networkApprovalContext)
  ) {
    details.networkApprovalContext = params.networkApprovalContext
  }
  if (method === 'item/permissions/requestApproval') {
    details.permissions = optionalObject(params.permissions)
  }
  if (method === 'applyPatchApproval') {
    details.files = Object.keys(optionalObject(params.fileChanges)).slice(
      0,
      256,
    )
  }
  return details
}

function approvalOptions(
  method: string,
  params: JsonObject,
): readonly CodexPermissionOption[] {
  if (
    method !== 'item/commandExecution/requestApproval' ||
    !Array.isArray(params.availableDecisions)
  ) {
    return PERMISSION_OPTIONS
  }
  return params.availableDecisions.flatMap((decision) => {
    if (typeof decision !== 'string') return []
    const option = PERMISSION_OPTIONS.find(({ id }) => id === decision)
    return option ? [option] : []
  })
}

function allowedPermissionDecision(
  choice: CodexPermissionDecision | null,
  options: readonly CodexPermissionOption[],
): CodexPermissionDecision {
  if (choice !== null && options.some(({ id }) => id === choice)) {
    return choice
  }
  if (options.some(({ id }) => id === 'decline')) return 'decline'
  if (options.some(({ id }) => id === 'cancel')) return 'cancel'
  return 'decline'
}

function approvalToolCallId(params: JsonObject, id: JsonRpcId): string {
  if (typeof params.approvalId === 'string') {
    return params.approvalId
  }
  if (typeof params.itemId === 'string') {
    return params.itemId
  }
  return typeof params.callId === 'string' ? params.callId : String(id)
}

function approvalSessionId(method: string, params: JsonObject): string {
  return requiredString(
    isLegacyApprovalMethod(method) ? params.conversationId : params.threadId,
    isLegacyApprovalMethod(method) ? 'conversationId' : 'threadId',
  )
}

function approvalResult(
  method: string,
  params: JsonObject,
  choice: CodexPermissionDecision | null,
): JsonObject {
  const decision = permissionDecision(choice)
  if (isLegacyApprovalMethod(method)) {
    return { decision: legacyPermissionDecision(decision) }
  }
  if (method !== 'item/permissions/requestApproval') {
    return { decision }
  }
  const accepted = decision === 'accept' || decision === 'acceptForSession'
  const requested = optionalObject(params.permissions)
  const permissions: JsonObject = {}
  if (
    requested.network !== null &&
    typeof requested.network === 'object' &&
    !Array.isArray(requested.network)
  ) {
    permissions.network = requested.network
  }
  if (
    requested.fileSystem !== null &&
    typeof requested.fileSystem === 'object' &&
    !Array.isArray(requested.fileSystem)
  ) {
    permissions.fileSystem = requested.fileSystem
  }
  return {
    permissions: accepted ? permissions : {},
    scope: decision === 'acceptForSession' ? 'session' : 'turn',
  }
}

function deniedApprovalResult(method: string): JsonObject {
  if (isLegacyApprovalMethod(method)) {
    return {
      decision: { denied: { rejection: 'User denied approval.' } },
    }
  }
  return method === 'item/permissions/requestApproval'
    ? { permissions: {}, scope: 'turn' }
    : { decision: 'decline' }
}

function permissionDecision(
  choice: CodexPermissionDecision | null,
): 'accept' | 'acceptForSession' | 'decline' | 'cancel' {
  switch (choice) {
    case 'accept':
    case 'acceptForSession':
    case 'cancel':
      return choice
    default:
      return 'decline'
  }
}

function legacyPermissionDecision(choice: CodexPermissionDecision): unknown {
  switch (choice) {
    case 'accept':
      return 'approved'
    case 'acceptForSession':
      return 'approved_for_session'
    case 'cancel':
      return 'abort'
    case 'decline':
      return { denied: { rejection: 'User denied approval.' } }
  }
}

function isLegacyApprovalMethod(method: string): boolean {
  return method === 'execCommandApproval' || method === 'applyPatchApproval'
}

function normalizeItem(item: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [
      camelToSnake(key),
      key === 'type' && typeof value === 'string' ? camelToSnake(value) : value,
    ]),
  )
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function sanitizeEvent(
  event: CodexAgentEvent,
  env: NodeJS.ProcessEnv,
): CodexAgentEvent {
  return sanitizeEventValue(redactSecrets(event), env) as CodexAgentEvent
}

function sanitizeEventValue(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return redactEnvironmentSecrets(value, env).slice(0, MAX_EVENT_STRING_CHARS)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeEventValue(entry, env))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeEventValue(entry, env),
      ]),
    )
  }
  return value
}

function sanitizeError(error: unknown, env: NodeJS.ProcessEnv): Error {
  const redacted = redactSecrets(normalizeError(error))
  const safe = new Error(
    redactEnvironmentSecrets(redacted.message, env).slice(
      0,
      MAX_EVENT_STRING_CHARS,
    ),
  )
  safe.name = redacted.name
  return safe
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function asObject(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Codex app-server ${name}.`)
  }
  return value as JsonObject
}

function optionalObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid Codex app-server ${name}.`)
  }
  return value
}

function appendBounded(
  previous: string,
  next: string,
  maxChars: number,
): string {
  if (maxChars <= 0) {
    return ''
  }
  if (next.length >= maxChars) {
    return next.slice(-maxChars)
  }
  return `${previous.slice(next.length - maxChars)}${next}`
}
