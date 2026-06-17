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
import { createCodexExecRuntime } from './codex/createCodexExecRuntime'
import type {
  CodexAgentEvent,
  CodexExecRequest,
  CodexRunHandle,
  CodexRuntime,
  CodexSandboxMode,
} from './types'

export const CODEX_TOOL_NAME = 'run_codex'

const MAX_CODEX_TOOL_OUTPUT_CHARS = 24_000

const codexToolArgsSchema = z.object({
  prompt: z.string().min(1),
  sandbox: z
    .enum(['read-only', 'workspace-write', 'danger-full-access'])
    .optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  summary: z.string().optional(),
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
  readonly command: string
  readonly cwd: string
  readonly sandbox: CodexSandboxMode
}

export class CodexToolRunner {
  public readonly disabled = !Platform.isDesktop

  private readonly app: App
  private settings: SmartComposerSettings
  private readonly unsubscribeFromSettings: () => void
  private runtime: CodexRuntime | null
  private readonly allowedExecutionsByConversation = new Map<
    string,
    Set<string>
  >()
  private readonly activeRuns = new Map<string, CodexRunHandle>()

  constructor({
    app,
    settings,
    registerSettingsListener,
    runtime,
  }: CodexToolRunnerOptions) {
    this.app = app
    this.settings = settings
    this.runtime = runtime ?? null
    this.unsubscribeFromSettings = registerSettingsListener((newSettings) => {
      this.settings = newSettings
    })
  }

  cleanup(): void {
    this.activeRuns.forEach((run) => run.abort())
    this.activeRuns.clear()
    this.allowedExecutionsByConversation.clear()
    this.unsubscribeFromSettings()
  }

  isAvailable(): boolean {
    return !this.disabled && this.settings.agent.codex.enabled
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
            sandbox: {
              type: 'string',
              enum: ['read-only', 'workspace-write', 'danger-full-access'],
              description:
                'Execution sandbox for Codex. Omit to use the Smart Composer default.',
            },
            cwd: {
              type: 'string',
              description:
                'Working directory for Codex. Omit to use the configured vault/project directory.',
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
    let allowedExecutions =
      this.allowedExecutionsByConversation.get(conversationId)
    if (!allowedExecutions) {
      allowedExecutions = new Set<string>()
      this.allowedExecutionsByConversation.set(
        conversationId,
        allowedExecutions,
      )
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
    return (
      this.allowedExecutionsByConversation
        .get(conversationId)
        ?.has(executionKey) ?? false
    )
  }

  async callTool({
    args,
    id,
    onEvent,
    signal,
  }: {
    readonly args?: string
    readonly id: string
    readonly onEvent?: (event: CodexAgentEvent) => void
    readonly signal?: AbortSignal
  }): Promise<ToolCallResponse> {
    if (!this.isAvailable()) {
      return {
        status: ToolCallResponseStatus.Error,
        error: 'Codex tool is only available in Obsidian desktop when enabled.',
      }
    }
    if (this.activeRuns.size > 0) {
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

    const runtime = await this.getRuntime()
    const request = this.buildExecRequest(parsedArgs.data)
    let lastAgentText = ''
    const run = runtime.execute(request, {
      onError: () => undefined,
      onEvent: (event) => {
        onEvent?.(event)
        const text = extractAgentText(event)
        if (text.length > 0) {
          lastAgentText = text
        }
      },
    })
    this.activeRuns.set(id, run)

    const abortListener = () => run.abort()
    signal?.addEventListener('abort', abortListener)

    try {
      const result = await run.done
      if (result.status === 'cancelled') {
        return { status: ToolCallResponseStatus.Aborted }
      }
      const output = lastAgentText.trim() || statusMessage(result.status)
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text: boundAndRedact(output),
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
    }
  }

  abortToolCall(id: string): boolean {
    const run = this.activeRuns.get(id)
    if (!run) {
      return false
    }
    run.abort()
    this.activeRuns.delete(id)
    return true
  }

  private buildExecRequest(args: CodexToolArgs): CodexExecRequest {
    return {
      approvalPolicy: this.settings.agent.codex.approvalPolicy,
      command: this.settings.agent.codex.command,
      cwd: normalizeOptionalString(args.cwd) ?? this.resolveDefaultCwd(),
      model: args.model,
      prompt: args.prompt,
      sandboxMode: args.sandbox ?? this.settings.agent.codex.defaultSandbox,
    }
  }

  private getExecutionKeyFromRequestArgs(args: string | undefined): string {
    const parsedArgs = this.parseArgs(args)
    const codexArgs = parsedArgs.success
      ? parsedArgs.data
      : {
          prompt: '',
        }
    return buildExecutionKey({
      command: this.settings.agent.codex.command,
      cwd: normalizeOptionalString(codexArgs.cwd) ?? this.resolveDefaultCwd(),
      sandbox: codexArgs.sandbox ?? this.settings.agent.codex.defaultSandbox,
    })
  }

  private parseArgs(args: string | undefined):
    | { readonly success: true; readonly data: CodexToolArgs }
    | {
        readonly success: false
        readonly error: string
      } {
    try {
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
    if (
      this.settings.agent.codex.cwdMode === 'custom' &&
      this.settings.agent.codex.customCwd.trim()
    ) {
      return this.settings.agent.codex.customCwd.trim()
    }
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      return this.app.vault.adapter.getBasePath()
    }
    return '/'
  }

  private async getRuntime(): Promise<CodexRuntime> {
    if (this.runtime === null) {
      this.runtime = await createCodexExecRuntime()
    }
    return this.runtime
  }
}

function buildExecutionKey({
  command,
  cwd,
  sandbox,
}: CodexExecutionKeyParams): string {
  return JSON.stringify({
    command,
    cwd,
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
