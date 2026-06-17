import type {
  CodexExecRequest,
  CodexRunHandle,
  CodexRunResult,
  CodexRuntime,
  CodexRuntimeHandlers,
} from '../types'

import { CodexCommandBuilder } from './CodexCommandBuilder'
import { CodexJsonlParseError, CodexJsonlParser } from './CodexJsonlParser'
import {
  CodexSpawnSpecResolver,
  type CodexSpawnSpecResolverOptions,
  buildWindowsSpawnOptions,
} from './CodexSpawnSpecResolver'

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
  readonly pid?: number
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

type CodexExecRuntimeOptions = {
  readonly commandBuilder?: CodexCommandBuilder
  readonly killTimeoutMs?: number
  readonly maxStderrBytes?: number
  readonly spawnProcess: CodexSpawn
  readonly spawnSpecResolver?: CodexSpawnSpecResolver
  readonly spawnSpecResolverOptions?: CodexSpawnSpecResolverOptions
}

export class CodexExecRuntime implements CodexRuntime {
  private readonly commandBuilder: CodexCommandBuilder
  private readonly killTimeoutMs: number
  private readonly maxStderrBytes: number
  private readonly spawnProcess: CodexSpawn
  private readonly spawnSpecResolver: CodexSpawnSpecResolver
  private readonly spawnSpecResolverOptions: CodexSpawnSpecResolverOptions

  constructor({
    commandBuilder = new CodexCommandBuilder(),
    killTimeoutMs = 2000,
    maxStderrBytes = 8192,
    spawnProcess,
    spawnSpecResolver = new CodexSpawnSpecResolver(),
    spawnSpecResolverOptions = {},
  }: CodexExecRuntimeOptions) {
    this.commandBuilder = commandBuilder
    this.killTimeoutMs = killTimeoutMs
    this.maxStderrBytes = maxStderrBytes
    this.spawnProcess = spawnProcess
    this.spawnSpecResolver = spawnSpecResolver
    this.spawnSpecResolverOptions = spawnSpecResolverOptions
  }

  execute(
    request: CodexExecRequest,
    handlers: CodexRuntimeHandlers,
  ): CodexRunHandle {
    const argv = this.commandBuilder.buildExecArgv(request)
    const spawnSpec = this.spawnSpecResolver.resolve(
      argv,
      this.spawnSpecResolverOptions,
    )
    const parser = new CodexJsonlParser()
    let stderr = ''
    let threadId: string | null = null
    let failedTurnLine: number | null = null
    let aborted = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    const childProcess = this.spawnProcess(spawnSpec.command, spawnSpec.args, {
      cwd: request.cwd,
      env: spawnSpec.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...buildWindowsSpawnOptions(spawnSpec),
    })
    childProcess.stdin?.end(request.prompt)

    const done = new Promise<CodexRunResult>((resolve, reject) => {
      const fail = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearKillTimer(killTimer)
        handlers.onError?.(error)
        reject(error)
      }

      childProcess.stdout?.on('data', (chunk: Buffer | string) => {
        try {
          for (const event of parser.push(chunk.toString())) {
            if (event.kind === 'thread.started') {
              threadId = event.threadId
            }
            if (event.kind === 'turn.failed') {
              failedTurnLine = event.line
            }
            handlers.onEvent(event)
          }
        } catch (error) {
          childProcess.kill('SIGTERM')
          fail(normalizeParserError(error))
        }
      })

      childProcess.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk.toString(), this.maxStderrBytes)
      })

      childProcess.on('error', (error) => {
        fail(error)
      })

      childProcess.on('close', (exitCode, signal) => {
        if (settled) {
          return
        }
        settled = true
        clearKillTimer(killTimer)

        try {
          for (const event of parser.flush()) {
            if (event.kind === 'thread.started') {
              threadId = event.threadId
            }
            if (event.kind === 'turn.failed') {
              failedTurnLine = event.line
            }
            handlers.onEvent(event)
          }
        } catch (error) {
          handlers.onError?.(normalizeParserError(error))
          reject(normalizeParserError(error))
          return
        }

        if (failedTurnLine !== null) {
          const error = new Error(
            `Codex turn failed at JSONL line ${failedTurnLine}${stderr ? `: ${stderr}` : ''}`,
          )
          handlers.onError?.(error)
          reject(error)
          return
        }

        if (
          !aborted &&
          signal === null &&
          exitCode !== null &&
          exitCode !== 0
        ) {
          const error = new Error(
            `Codex process exited with code ${exitCode}${stderr ? `: ${stderr}` : ''}`,
          )
          handlers.onError?.(error)
          reject(error)
          return
        }

        const status =
          aborted || signal !== null
            ? 'cancelled'
            : exitCode === 0
              ? 'completed'
              : 'failed'
        resolve({
          exitCode,
          signal,
          status,
          stderr,
          threadId,
        })
      })
    })

    return {
      done,
      abort: () => {
        aborted = true
        if (childProcess.kill('SIGTERM')) {
          killTimer = setTimeout(() => {
            childProcess.kill('SIGKILL')
          }, this.killTimeoutMs)
        }
      },
    }
  }
}

function normalizeParserError(error: unknown): Error {
  if (error instanceof CodexJsonlParseError) {
    return error
  }
  if (error instanceof Error) {
    return error
  }
  return new Error('Codex JSONL parsing failed')
}

function appendBounded(
  previous: string,
  next: string,
  maxBytes: number,
): string {
  const combined = `${previous}${next}`
  if (combined.length <= maxBytes) {
    return combined
  }
  return combined.slice(combined.length - maxBytes)
}

function clearKillTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer !== null) {
    clearTimeout(timer)
  }
}
