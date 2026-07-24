import { App, FileSystemAdapter, Platform } from 'obsidian'
import { z } from 'zod'

import type { SmartComposerSettings } from '../../settings/schema/setting.types'
import type { RequestTool } from '../../types/llm/request'
import {
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import { redactSecrets } from '../../utils/security/redact-secrets'

import { extractAgentText, statusMessage } from './agent-output'
import { createCodexRuntime } from './codex/createCodexRuntime'
import type {
  CodexAgentEvent,
  CodexApprovalPolicy,
  CodexExecRequest,
  CodexPermissionDecision,
  CodexPermissionRequest,
  CodexRunHandle,
  CodexRunResult,
  CodexRuntime,
  CodexRuntimeHandlers,
  CodexSandboxMode,
  CodexSessionRequest,
} from './types'

export const CODEX_TOOL_NAME = 'run_codex'
export const MAX_CODEX_TOOL_PROMPT_CHARS = 2 * 1024 * 1024

const MAX_CODEX_TOOL_OUTPUT_CHARS = 24_000
const MAX_CODEX_TOOL_ARGUMENT_CHARS = 4 * 1024 * 1024
const MAX_ALLOWED_CONVERSATIONS = 1_000
const MAX_ALLOWED_EXECUTIONS_PER_CONVERSATION = 100
const SAFE_THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

const codexToolArgsSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_CODEX_TOOL_PROMPT_CHARS),
  model: z.string().max(512).optional(),
  summary: z.string().max(512).optional(),
})

type CodexToolArgs = z.infer<typeof codexToolArgsSchema>

type CodexToolRunnerOptions = {
  readonly app: App
  readonly settings: SmartComposerSettings
  readonly registerSettingsListener: (
    listener: (settings: SmartComposerSettings) => void,
  ) => () => void
  readonly runtime?: CodexRuntime
}

type CodexExecutionKeyParams = {
  readonly approvalPolicy: CodexApprovalPolicy
  readonly command: string
  readonly cwd: string
  readonly model?: string
  readonly prompt: string
  readonly sandbox: CodexSandboxMode
}

export class CodexToolRunner {
  public readonly disabled = !Platform.isDesktop

  private readonly app: App
  private settings: SmartComposerSettings
  private readonly unsubscribeFromSettings: () => void
  private runtime: CodexRuntime | null
  private readonly runtimeInjected: boolean
  private runtimeCommand: string | null = null
  private runtimeLoading: Promise<CodexRuntime> | null = null
  private readonly allowedExecutionsByConversation = new Map<
    string,
    Set<string>
  >()
  private readonly activeRuns = new Map<string, CodexRunHandle>()
  private readonly abortingRunIds = new Set<string>()
  private startingRun = false
  private disposed = false

  constructor({
    app,
    settings,
    registerSettingsListener,
    runtime,
  }: CodexToolRunnerOptions) {
    this.app = app
    this.settings = settings
    this.runtime = runtime ?? null
    this.runtimeInjected = runtime !== undefined
    this.unsubscribeFromSettings = registerSettingsListener((newSettings) => {
      this.settings = newSettings
    })
  }

  async cleanup(): Promise<void> {
    this.disposed = true
    const activeRuns = [...this.activeRuns.values()]
    activeRuns.forEach((run) => run.abort())
    this.activeRuns.clear()
    this.abortingRunIds.clear()
    this.allowedExecutionsByConversation.clear()
    this.unsubscribeFromSettings()
    const runtimeLoading = this.runtimeLoading
    if (runtimeLoading) {
      await Promise.allSettled([runtimeLoading])
    }
    const runtime = this.runtime
    this.runtime = null
    this.runtimeCommand = null
    await runtime?.dispose?.()
    await Promise.allSettled(activeRuns.map((run) => run.done))
  }

  isAvailable(): boolean {
    return !this.disposed && !this.disabled && this.settings.agent.codex.enabled
  }

  getToolDefinition(): RequestTool {
    return {
      type: 'function',
      function: {
        name: CODEX_TOOL_NAME,
        description:
          'Use Codex to inspect, edit, refactor, test, or perform multi-step work in the current project or vault. Do not use it for explanation-only answers.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'The concrete implementation or investigation task Codex should perform.',
            },
            model: {
              type: 'string',
              description: 'Optional Codex model override.',
            },
            summary: {
              type: 'string',
              description: 'Short label for the pending tool call UI.',
            },
          },
        },
      },
    }
  }

  allowToolForConversation(
    requestArgs: string | undefined,
    conversationId: string,
  ): void {
    const executionKey = this.getExecutionKeyFromRequestArgs(requestArgs)
    if (executionKey === null) {
      return
    }
    let allowedExecutions =
      this.allowedExecutionsByConversation.get(conversationId)
    if (!allowedExecutions) {
      if (
        this.allowedExecutionsByConversation.size >= MAX_ALLOWED_CONVERSATIONS
      ) {
        const oldestConversation = this.allowedExecutionsByConversation
          .keys()
          .next()
        if (!oldestConversation.done) {
          this.allowedExecutionsByConversation.delete(oldestConversation.value)
        }
      }
      allowedExecutions = new Set<string>()
      this.allowedExecutionsByConversation.set(
        conversationId,
        allowedExecutions,
      )
    }
    if (
      !allowedExecutions.has(executionKey) &&
      allowedExecutions.size >= MAX_ALLOWED_EXECUTIONS_PER_CONVERSATION
    ) {
      const oldestExecution = allowedExecutions.values().next()
      if (!oldestExecution.done) {
        allowedExecutions.delete(oldestExecution.value)
      }
    }
    allowedExecutions.add(executionKey)
  }

  isExecutionAllowed({
    requestArgs,
    conversationId,
  }: {
    readonly requestArgs?: string
    readonly conversationId?: string
  }): boolean {
    if (!this.isAvailable() || !conversationId) {
      return false
    }
    const executionKey = this.getExecutionKeyFromRequestArgs(requestArgs)
    if (executionKey === null) {
      return false
    }
    return (
      this.allowedExecutionsByConversation
        .get(conversationId)
        ?.has(executionKey) ?? false
    )
  }

  async callTool({
    args,
    id,
    codexSession,
    onEvent,
    onPermissionRequest,
    signal,
  }: {
    readonly args?: string
    readonly id: string
    readonly codexSession?: CodexSessionRequest
    readonly onEvent?: (event: CodexAgentEvent) => void
    readonly onPermissionRequest?: (
      request: CodexPermissionRequest,
    ) => Promise<CodexPermissionDecision | null>
    readonly signal?: AbortSignal
  }): Promise<ToolCallResponse> {
    if (!this.isAvailable()) {
      return {
        status: ToolCallResponseStatus.Error,
        error: 'Codex tool is only available in Obsidian desktop when enabled.',
      }
    }
    if (!this.startingRun && this.activeRuns.size > 0) {
      const abortingRuns = [...this.activeRuns].filter(([id]) =>
        this.abortingRunIds.has(id),
      )
      if (abortingRuns.length === this.activeRuns.size) {
        await Promise.allSettled(abortingRuns.map(([, run]) => run.done))
        await Promise.resolve()
      }
    }
    if (this.startingRun || this.activeRuns.size > 0) {
      return {
        status: ToolCallResponseStatus.Error,
        error: 'Another Codex run is already active.',
      }
    }

    const parsedArgs = this.parseArgs(args)
    if (!parsedArgs.success) {
      return {
        status: ToolCallResponseStatus.Error,
        error: parsedArgs.error,
      }
    }
    if (signal?.aborted) {
      return { status: ToolCallResponseStatus.Aborted }
    }

    let request: CodexExecRequest
    try {
      request = this.buildExecRequest(parsedArgs.data, codexSession)
    } catch (error) {
      return {
        status: ToolCallResponseStatus.Error,
        error: boundAndRedact(
          error instanceof Error ? error.message : String(error),
        ),
      }
    }
    let lastAgentText = ''
    let receivedEvent = false
    let run: CodexRunHandle
    let runtime: CodexRuntime
    const runtimeHandlers: CodexRuntimeHandlers = {
      onError: () => undefined,
      onEvent: (event: CodexAgentEvent) => {
        receivedEvent = true
        onEvent?.(event)
        const text = extractAgentText(event)
        if (text.length > 0) {
          lastAgentText = text
        }
      },
      onPermissionRequest,
    }
    this.startingRun = true
    try {
      runtime = await this.getRuntime(request.command ?? 'codex')
      if (!this.isAvailable() || signal?.aborted) {
        return { status: ToolCallResponseStatus.Aborted }
      }
      run = runtime.execute(request, runtimeHandlers)
      this.activeRuns.set(id, run)
    } catch (error) {
      return {
        status: ToolCallResponseStatus.Error,
        error: boundAndRedact(
          error instanceof Error ? error.message : String(error),
        ),
      }
    } finally {
      this.startingRun = false
    }

    const abortListener = () => this.abortRun(id, run)
    signal?.addEventListener('abort', abortListener, { once: true })

    try {
      let result: CodexRunResult
      try {
        result = await run.done
      } catch (error) {
        if (
          !request.resume ||
          !codexSession ||
          receivedEvent ||
          signal?.aborted
        ) {
          throw error
        }
        run = runtime.execute(
          {
            ...request,
            prompt: codexSession.initialPrompt,
            resume: undefined,
          },
          runtimeHandlers,
        )
        this.activeRuns.set(id, run)
        result = await run.done
      }
      if (result.status === 'cancelled') {
        return { status: ToolCallResponseStatus.Aborted }
      }
      const output = lastAgentText.trim() || statusMessage(result.status)
      const resumableSession =
        codexSession &&
        this.settings.agent.codex.resume &&
        result.status === 'completed' &&
        isSafeThreadId(result.threadId)
          ? {
              approvalPolicy: request.approvalPolicy,
              cwd: request.cwd,
              sandboxMode: request.sandboxMode,
              threadId: result.threadId,
            }
          : undefined
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text: boundAndRedact(output),
          ...(resumableSession ? { codexSession: resumableSession } : {}),
        },
      }
    } catch (error) {
      return {
        status: ToolCallResponseStatus.Error,
        error: boundAndRedact(
          error instanceof Error ? error.message : String(error),
        ),
      }
    } finally {
      signal?.removeEventListener('abort', abortListener)
      this.activeRuns.delete(id)
      this.abortingRunIds.delete(id)
    }
  }

  abortToolCall(id: string): boolean {
    const run = this.activeRuns.get(id)
    if (!run) {
      return false
    }
    this.abortRun(id, run)
    return true
  }

  private abortRun(id: string, run: CodexRunHandle): void {
    this.abortingRunIds.add(id)
    run.abort()
  }

  private buildExecRequest(
    args: CodexToolArgs,
    session?: CodexSessionRequest,
  ): CodexExecRequest {
    const approvalPolicy = this.settings.agent.codex.approvalPolicy
    const cwd = this.resolveDefaultCwd()
    const sandboxMode = this.settings.agent.codex.defaultSandbox
    const resume =
      this.settings.agent.codex.resume &&
      session?.resume?.approvalPolicy === approvalPolicy &&
      session.resume.cwd === cwd &&
      session.resume.sandboxMode === sandboxMode &&
      isSafeThreadId(session.resume.threadId)
        ? session.resume
        : undefined

    return {
      approvalPolicy,
      command: this.settings.agent.codex.command,
      cwd,
      model: normalizeOptionalString(args.model),
      prompt: resume ? args.prompt : (session?.initialPrompt ?? args.prompt),
      resume,
      sandboxMode,
    }
  }

  private getExecutionKeyFromRequestArgs(
    args: string | undefined,
  ): string | null {
    const parsedArgs = this.parseArgs(args)
    const codexArgs = parsedArgs.success
      ? parsedArgs.data
      : {
          prompt: '',
        }
    try {
      return buildExecutionKey({
        approvalPolicy: this.settings.agent.codex.approvalPolicy,
        command: this.settings.agent.codex.command,
        cwd: this.resolveDefaultCwd(),
        model: normalizeOptionalString(codexArgs.model),
        prompt: codexArgs.prompt.trim(),
        sandbox: this.settings.agent.codex.defaultSandbox,
      })
    } catch {
      return null
    }
  }

  private parseArgs(args: string | undefined):
    | { readonly success: true; readonly data: CodexToolArgs }
    | {
        readonly success: false
        readonly error: string
      } {
    try {
      if (args && args.length > MAX_CODEX_TOOL_ARGUMENT_CHARS) {
        throw new Error('arguments exceed the 1 MiB limit')
      }
      const raw = args ? JSON.parse(args) : {}
      return {
        success: true,
        data: codexToolArgsSchema.parse(raw),
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `Invalid Codex tool arguments: ${error.message}`
            : 'Invalid Codex tool arguments.',
      }
    }
  }

  private resolveDefaultCwd(): string {
    const customCwd = this.settings.agent.codex.customCwd.trim()
    if (this.settings.agent.codex.cwdMode === 'custom') {
      if (!customCwd || !ABSOLUTE_PATH_PATTERN.test(customCwd)) {
        throw new Error(
          'Codex custom working directory must be a non-empty absolute path.',
        )
      }
      return customCwd
    }
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
      throw new Error(
        'Codex requires a local filesystem vault or an absolute custom working directory.',
      )
    }
    const vaultCwd = this.app.vault.adapter.getBasePath().trim()
    if (!vaultCwd || !ABSOLUTE_PATH_PATTERN.test(vaultCwd)) {
      throw new Error(
        'Codex vault working directory must be a non-empty absolute path.',
      )
    }
    return vaultCwd
  }

  private async getRuntime(requestedCommand: string): Promise<CodexRuntime> {
    if (this.runtimeInjected) {
      if (this.runtime === null) {
        throw new Error('Injected Codex runtime is unavailable.')
      }
      return this.runtime
    }

    const command = requestedCommand.trim() || 'codex'
    const runtimeLoading = this.loadRuntime(command)
    this.runtimeLoading = runtimeLoading
    try {
      const runtime = await runtimeLoading
      if (this.disposed) {
        throw new Error(
          'Codex tool runner was disposed while loading its runtime.',
        )
      }
      return runtime
    } finally {
      if (this.runtimeLoading === runtimeLoading) {
        this.runtimeLoading = null
      }
    }
  }

  private async loadRuntime(command: string): Promise<CodexRuntime> {
    if (this.runtime !== null && this.runtimeCommand !== command) {
      const staleRuntime = this.runtime
      this.runtime = null
      this.runtimeCommand = null
      await staleRuntime.dispose?.()
    }
    if (this.runtime === null) {
      this.runtime = await createCodexRuntime()
      this.runtimeCommand = command
    }
    return this.runtime
  }
}

function buildExecutionKey({
  approvalPolicy,
  command,
  cwd,
  model,
  prompt,
  sandbox,
}: CodexExecutionKeyParams): string {
  return JSON.stringify({
    approvalPolicy,
    command,
    cwd,
    model,
    prompt,
    sandbox,
    tool: CODEX_TOOL_NAME,
  })
}

function boundAndRedact(text: string): string {
  return redactSecrets(text).slice(0, MAX_CODEX_TOOL_OUTPUT_CHARS)
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmedValue = value?.trim()
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined
}

function isSafeThreadId(threadId: string | null): threadId is string {
  return (
    threadId !== null &&
    threadId.length <= 512 &&
    SAFE_THREAD_ID_PATTERN.test(threadId)
  )
}
