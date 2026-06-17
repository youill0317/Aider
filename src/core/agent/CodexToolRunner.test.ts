import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { CodexToolRunner } from './CodexToolRunner'
import {
  CodexApprovalPolicy,
  CodexExecRequest,
  CodexRunResult,
  CodexRuntime,
  CodexRuntimeHandlers,
  CodexSandboxMode,
} from './types'

type CodexSettingsOverride = {
  readonly approvalPolicy?: CodexApprovalPolicy
  readonly customCwd?: string
  readonly cwdMode?: 'custom' | 'vault'
  readonly defaultSandbox?: CodexSandboxMode
  readonly enabled?: boolean
}

describe('CodexToolRunner', () => {
  it('uses the configured Codex approval policy when building a run request', async () => {
    const requests: CodexExecRequest[] = []
    const runtime: CodexRuntime = {
      execute: (request) => {
        requests.push(request)
        return {
          abort: jest.fn(),
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            status: 'completed',
            stderr: '',
            threadId: 'thread-1',
          }),
        }
      },
    }
    const settings = smartComposerSettingsSchema.parse({
      agent: {
        codex: {
          approvalPolicy: 'on-request',
          customCwd: '/vault',
          cwdMode: 'custom',
          defaultSandbox: 'read-only',
          enabled: true,
        },
      },
    })
    const runner = new CodexToolRunner({
      app: {} as never,
      settings,
      registerSettingsListener: () => () => undefined,
      runtime,
    })

    await runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].approvalPolicy).toBe('on-request')
  })

  it('rejects a second Codex run while one run is active', async () => {
    const runtime = createDeferredRuntime()
    const runner = createRunner({ runtime })

    const firstRun = runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
    })
    await runtime.waitForExecutions(1)
    const secondResponse = await runner.callTool({
      args: JSON.stringify({ prompt: 'Run tests' }),
      id: 'tool-call-2',
    })
    runtime.resolveRun(createRunResult('cancelled'))
    await firstRun

    expect(secondResponse).toEqual({
      status: ToolCallResponseStatus.Error,
      error: 'Another Codex run is already active.',
    })
  })

  it('aborts the active Codex run when the caller aborts the signal', async () => {
    const runtime = createDeferredRuntime()
    const runner = createRunner({ runtime })
    const abortController = new AbortController()

    const responsePromise = runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
      signal: abortController.signal,
    })
    await runtime.waitForExecutions(1)
    abortController.abort()
    runtime.resolveRun(createRunResult('cancelled'))
    const response = await responsePromise

    expect(runtime.abort).toHaveBeenCalledTimes(1)
    expect(response).toEqual({
      status: ToolCallResponseStatus.Aborted,
    })
  })

  it('uses only the last Codex agent message as the final tool result', async () => {
    const runner = createRunner({
      runtime: {
        execute: (_request, handlers) => {
          handlers.onEvent({
            kind: 'item.completed',
            line: 1,
            item: {
              id: 'item_1',
              text: 'I will inspect the directory.',
              type: 'agent_message',
            },
          })
          handlers.onEvent({
            kind: 'item.completed',
            line: 2,
            item: {
              id: 'item_2',
              text: 'Final answer only.',
              type: 'agent_message',
            },
          })
          return {
            abort: jest.fn(),
            done: Promise.resolve(createRunResult('completed')),
          }
        },
      },
    })

    const response = await runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
    })

    expect(response).toEqual({
      status: ToolCallResponseStatus.Success,
      data: {
        type: 'text',
        text: 'Final answer only.',
      },
    })
  })
})

function createRunner({
  runtime = createCompletedRuntime(),
  settingsOverrides = {},
}: {
  readonly runtime?: CodexRuntime
  readonly settingsOverrides?: {
    readonly agent?: {
      readonly codex?: CodexSettingsOverride
    }
  }
} = {}): CodexToolRunner {
  const settings = smartComposerSettingsSchema.parse({
    agent: {
      codex: {
        customCwd: '/vault',
        cwdMode: 'custom',
        ...settingsOverrides.agent?.codex,
      },
    },
  })

  return new CodexToolRunner({
    app: {} as never,
    settings,
    registerSettingsListener: () => () => undefined,
    runtime,
  })
}

function createCompletedRuntime(): CodexRuntime {
  return {
    execute: () => ({
      abort: jest.fn(),
      done: Promise.resolve(createRunResult('completed')),
    }),
  }
}

function createDeferredRuntime(): CodexRuntime & {
  readonly abort: jest.Mock
  resolveRun: (result: CodexRunResult) => void
  waitForExecutions: (count: number) => Promise<void>
} {
  const abort = jest.fn()
  let executionCount = 0
  let resolveRun: ((result: CodexRunResult) => void) | null = null
  const executionWaiters: {
    readonly count: number
    readonly resolve: () => void
  }[] = []
  const done = new Promise<CodexRunResult>((resolve) => {
    resolveRun = resolve
  })

  return {
    abort,
    execute: (_request: CodexExecRequest, _handlers: CodexRuntimeHandlers) => {
      executionCount += 1
      executionWaiters
        .filter((waiter) => executionCount >= waiter.count)
        .forEach((waiter) => waiter.resolve())
      return {
        abort,
        done,
      }
    },
    resolveRun: (result: CodexRunResult) => {
      if (resolveRun === null) {
        throw new Error('Deferred Codex runtime was not initialized.')
      }
      resolveRun(result)
    },
    waitForExecutions: (count: number) => {
      if (executionCount >= count) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        executionWaiters.push({ count, resolve })
      })
    },
  }
}

function createRunResult(status: CodexRunResult['status']): CodexRunResult {
  return {
    exitCode: status === 'completed' ? 0 : 1,
    signal: null,
    status,
    stderr: '',
    threadId: status === 'completed' ? 'thread-1' : null,
  }
}
