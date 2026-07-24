import { FileSystemAdapter } from 'obsidian'

import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { CodexToolRunner } from './CodexToolRunner'
import type {
  CodexExecRequest,
  CodexPermissionDecision,
  CodexRunResult,
  CodexRuntime,
  CodexRuntimeHandlers,
  CodexSandboxMode,
} from './types'

jest.mock('obsidian', () => ({
  FileSystemAdapter: class {
    constructor(private readonly basePath: string) {}

    getBasePath() {
      return this.basePath
    }
  },
  Platform: { isDesktop: true },
}))

type CodexSettingsOverride = {
  readonly customCwd?: string
  readonly cwdMode?: 'custom' | 'vault'
  readonly defaultSandbox?: CodexSandboxMode
}

describe('CodexToolRunner security boundaries', () => {
  it('does not expose model-controlled cwd or sandbox in the tool schema', () => {
    const runner = createRunner()

    const toolDefinition = runner.getToolDefinition()

    expect(toolDefinition.function.parameters.properties).not.toHaveProperty(
      'cwd',
    )
    expect(toolDefinition.function.parameters.properties).not.toHaveProperty(
      'sandbox',
    )
  })

  it('ignores model-supplied cwd and sandbox when building a run request', async () => {
    const requests: CodexExecRequest[] = []
    const runner = createRunner({
      runtime: {
        execute: (request) => {
          requests.push(request)
          return {
            abort: jest.fn(),
            done: Promise.resolve(createRunResult('completed')),
          }
        },
      },
      settingsOverrides: {
        agent: {
          codex: {
            customCwd: '/configured-vault',
            cwdMode: 'custom',
            defaultSandbox: 'read-only',
          },
        },
      },
    })

    await runner.callTool({
      args: JSON.stringify({
        cwd: '/tmp/model-controlled',
        prompt: 'Inspect the project',
        sandbox: 'danger-full-access',
      }),
      id: 'tool-call-1',
    })

    expect(requests[0]).toMatchObject({
      cwd: '/configured-vault',
      sandboxMode: 'read-only',
    })
  })

  it('forwards permission requests only through the caller-provided handler', async () => {
    let runtimeHandlers: CodexRuntimeHandlers | undefined
    const onPermissionRequest = jest.fn(
      async (): Promise<CodexPermissionDecision> => 'accept',
    )
    const runner = createRunner({
      runtime: {
        execute: (_request, handlers) => {
          runtimeHandlers = handlers
          return {
            abort: jest.fn(),
            done: Promise.resolve(createRunResult('completed')),
          }
        },
      },
    })

    await runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
      onPermissionRequest,
    })

    expect(runtimeHandlers?.onPermissionRequest).toBe(onPermissionRequest)
  })

  it('disposes its runtime to release an active run during cleanup', async () => {
    let resolveRun: ((result: CodexRunResult) => void) | undefined
    const done = new Promise<CodexRunResult>((resolve) => {
      resolveRun = resolve
    })
    const dispose = jest.fn(() => {
      resolveRun?.(createRunResult('cancelled'))
    })
    const abort = jest.fn()
    const execute = jest.fn(() => ({
      abort,
      done,
    }))
    const runner = createRunner({ runtime: { dispose, execute } })
    const call = runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
    })
    await Promise.resolve()
    await Promise.resolve()

    await Promise.all([call, runner.cleanup()])
    expect(abort).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['', 'relative/path'])(
    'rejects unsafe custom cwd %p without executing',
    async (customCwd) => {
      const execute = jest.fn()
      const runner = createRunner({
        runtime: { execute },
        settingsOverrides: {
          agent: { codex: { customCwd, cwdMode: 'custom' } },
        },
      })
      const requestArgs = JSON.stringify({ prompt: 'Inspect the project' })

      runner.allowToolForConversation(requestArgs, 'conversation-1')
      const response = await runner.callTool({
        args: requestArgs,
        id: 'tool-call-1',
      })

      expect(
        runner.isExecutionAllowed({
          conversationId: 'conversation-1',
          requestArgs,
        }),
      ).toBe(false)
      expect(response).toMatchObject({
        status: ToolCallResponseStatus.Error,
        error: expect.stringContaining('non-empty absolute path'),
      })
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['a non-local vault', {}, 'local filesystem vault'],
    [
      'an empty local vault path',
      createFileSystemAdapter(''),
      'non-empty absolute path',
    ],
    [
      'a relative local vault path',
      createFileSystemAdapter('relative/vault'),
      'non-empty absolute path',
    ],
  ])('rejects %s without executing', async (_label, adapter, errorText) => {
    const execute = jest.fn()
    const runner = createRunner({
      app: { vault: { adapter } },
      runtime: { execute },
      settingsOverrides: {
        agent: { codex: { cwdMode: 'vault' } },
      },
    })

    const response = await runner.callTool({
      args: JSON.stringify({ prompt: 'Inspect the project' }),
      id: 'tool-call-1',
    })

    expect(response).toMatchObject({
      status: ToolCallResponseStatus.Error,
      error: expect.stringContaining(errorText),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('scopes chat approval to the normalized prompt and model', () => {
    const runner = createRunner()
    const conversationId = 'conversation-1'
    runner.allowToolForConversation(
      JSON.stringify({
        model: ' gpt-5 ',
        prompt: ' Inspect the project ',
      }),
      conversationId,
    )

    expect(
      runner.isExecutionAllowed({
        conversationId,
        requestArgs: JSON.stringify({
          model: 'gpt-5',
          prompt: 'Inspect the project',
        }),
      }),
    ).toBe(true)
    expect(
      runner.isExecutionAllowed({
        conversationId,
        requestArgs: JSON.stringify({
          model: 'gpt-5',
          prompt: 'Run tests',
        }),
      }),
    ).toBe(false)
    expect(
      runner.isExecutionAllowed({
        conversationId,
        requestArgs: JSON.stringify({
          model: 'gpt-5.1',
          prompt: 'Inspect the project',
        }),
      }),
    ).toBe(false)
  })

  it('invalidates chat approval when the approval policy changes', () => {
    const initialSettings = smartComposerSettingsSchema.parse({
      agent: {
        codex: {
          approvalPolicy: 'on-request',
          customCwd: '/vault',
          cwdMode: 'custom',
        },
      },
    })
    let updateSettings: (settings: typeof initialSettings) => void = () =>
      undefined
    const runner = new CodexToolRunner({
      app: {} as never,
      settings: initialSettings,
      registerSettingsListener: (listener) => {
        updateSettings = listener
        return () => undefined
      },
      runtime: createCompletedRuntime(),
    })
    const requestArgs = JSON.stringify({ prompt: 'Inspect the project' })
    runner.allowToolForConversation(requestArgs, 'conversation-1')

    updateSettings(
      smartComposerSettingsSchema.parse({
        ...initialSettings,
        agent: {
          codex: {
            ...initialSettings.agent.codex,
            approvalPolicy: 'never',
          },
        },
      }),
    )

    expect(
      runner.isExecutionAllowed({
        conversationId: 'conversation-1',
        requestArgs,
      }),
    ).toBe(false)
  })

  it('bounds remembered approvals by conversation and execution', () => {
    const runner = createRunner()
    for (let index = 0; index <= 1_000; index += 1) {
      runner.allowToolForConversation(
        JSON.stringify({ prompt: `Conversation prompt ${index}` }),
        `conversation-${index}`,
      )
    }
    for (let index = 0; index <= 100; index += 1) {
      runner.allowToolForConversation(
        JSON.stringify({ prompt: `Execution prompt ${index}` }),
        'conversation-1000',
      )
    }

    expect(
      runner.isExecutionAllowed({
        conversationId: 'conversation-0',
        requestArgs: JSON.stringify({ prompt: 'Conversation prompt 0' }),
      }),
    ).toBe(false)
    expect(
      runner.isExecutionAllowed({
        conversationId: 'conversation-1000',
        requestArgs: JSON.stringify({ prompt: 'Execution prompt 0' }),
      }),
    ).toBe(false)
    expect(
      runner.isExecutionAllowed({
        conversationId: 'conversation-1000',
        requestArgs: JSON.stringify({ prompt: 'Execution prompt 100' }),
      }),
    ).toBe(true)
  })
})

function createRunner({
  app = {},
  runtime = createCompletedRuntime(),
  settingsOverrides = {},
}: {
  readonly app?: unknown
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
    app: app as never,
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

function createFileSystemAdapter(basePath: string): FileSystemAdapter {
  const adapter = new FileSystemAdapter()
  jest.spyOn(adapter, 'getBasePath').mockReturnValue(basePath)
  return adapter
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
