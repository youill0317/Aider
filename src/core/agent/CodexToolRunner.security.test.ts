import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'

import { CodexToolRunner } from './CodexToolRunner'
import type {
  CodexExecRequest,
  CodexRunResult,
  CodexRuntime,
  CodexSandboxMode,
} from './types'

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

function createRunResult(status: CodexRunResult['status']): CodexRunResult {
  return {
    exitCode: status === 'completed' ? 0 : 1,
    signal: null,
    status,
    stderr: '',
    threadId: status === 'completed' ? 'thread-1' : null,
  }
}
