import type { ChatMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import type { AgentSessionPrompts } from './agent-chat'
import { agentTurnResultContent, runAgentTurn } from './run-agent-turn'
import type { ToolDispatcher } from './tool-dispatcher'

type CallToolParams = Parameters<ToolDispatcher['callTool']>[0]

const PROMPTS: AgentSessionPrompts = {
  initialPrompt: 'initial',
  prompt: 'do the thing',
  resume: undefined,
}

function setup(
  callTool: (params: CallToolParams) => Promise<ToolCallResponse>,
  { isCurrent = () => true }: { isCurrent?: () => boolean } = {},
) {
  let messages: ChatMessage[] = []
  const controller = new AbortController()
  const run = runAgentTurn({
    callTool,
    isCurrent,
    prompts: PROMPTS,
    setChatMessages: (updater) => {
      messages = updater(messages)
    },
    signal: controller.signal,
    toolCallId: 'call-1',
  })
  return { controller, messages: () => messages, run }
}

type ToolCallResponse = Awaited<ReturnType<ToolDispatcher['callTool']>>

describe('agentTurnResultContent', () => {
  it('shows the agent text on success', () => {
    expect(
      agentTurnResultContent({
        status: ToolCallResponseStatus.Success,
        data: { type: 'text', text: 'all done' },
      }),
    ).toBe('all done')
  })

  it('reports a stop instead of an empty turn', () => {
    expect(
      agentTurnResultContent({ status: ToolCallResponseStatus.Aborted }),
    ).toBe('Agent Chat was stopped.')
  })

  it('surfaces the error text so failures are visible in the transcript', () => {
    expect(
      agentTurnResultContent({
        status: ToolCallResponseStatus.Error,
        error: 'codex exited with code 1',
      }),
    ).toBe('codex exited with code 1')
  })

  it('names an unexpected terminal status rather than going silent', () => {
    expect(
      agentTurnResultContent({ status: ToolCallResponseStatus.Rejected }),
    ).toBe('Agent Chat ended with status: rejected')
  })
})

describe('runAgentTurn', () => {
  it('sends the prompt and session, and appends the final assistant message', async () => {
    const received: CallToolParams[] = []
    const { messages, run } = setup(async (params) => {
      received.push(params)
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text: 'finished',
          codexSession: { threadId: 'thread-1' } as never,
        },
      }
    })
    await run

    expect(received).toHaveLength(1)
    expect(received[0].id).toBe('call-1')
    expect(received[0].codexSession).toEqual({
      initialPrompt: 'initial',
      resume: undefined,
    })
    expect(messages()).toHaveLength(1)
    const [assistant] = messages()
    expect(assistant.role).toBe('assistant')
    expect(assistant.role === 'assistant' && assistant.content).toBe('finished')
    expect(
      assistant.role === 'assistant' && assistant.metadata?.agentSession,
    ).toEqual({ threadId: 'thread-1' })
  })

  it('streams command activity into the transcript before the final message', async () => {
    const { messages, run } = setup(async (params) => {
      params.onEvent?.({
        kind: 'item.started',
        line: 1,
        item: {
          type: 'command_execution',
          id: 'cmd-1',
          command: 'ls',
          status: 'in_progress',
        },
      })
      params.onEvent?.({
        kind: 'item.completed',
        line: 2,
        item: {
          type: 'command_execution',
          id: 'cmd-1',
          command: 'ls',
          status: 'completed',
          exit_code: 0,
          aggregated_output: 'README.md',
        },
      })
      return {
        status: ToolCallResponseStatus.Success,
        data: { type: 'text', text: 'done' },
      }
    })
    await run

    // The two events target one command id, so they collapse into one row.
    expect(messages()).toHaveLength(2)
    expect(messages()[0].id).toBe('agent-command:cmd-1')
    expect(messages()[1].role).toBe('assistant')
  })

  it('reports a thrown dispatcher error as an assistant message instead of rejecting', async () => {
    const { messages, run } = setup(async () => {
      throw new Error('spawn codex ENOENT')
    })

    await expect(run).resolves.toBeUndefined()
    expect(messages()).toHaveLength(1)
    expect(messages()[0].role === 'assistant' && messages()[0]).toMatchObject({
      content: 'spawn codex ENOENT',
    })
  })

  it('redacts secrets out of a thrown dispatcher error', async () => {
    const { messages, run } = setup(async () => {
      throw new Error('failed with Authorization: Bearer sk-live-secret')
    })
    await run

    const [message] = messages()
    const content = message.role === 'assistant' ? message.content : ''
    expect(content).toContain('[REDACTED]')
    expect(content).not.toContain('sk-live-secret')
  })

  it('drops the result when the turn was superseded', async () => {
    const { messages, run } = setup(
      async () => ({
        status: ToolCallResponseStatus.Success,
        data: { type: 'text', text: 'stale answer' },
      }),
      { isCurrent: () => false },
    )
    await run

    expect(messages()).toEqual([])
  })

  it('drops streamed events when the turn was superseded', async () => {
    const { messages, run } = setup(
      async (params) => {
        params.onEvent?.({
          kind: 'item.started',
          line: 1,
          item: {
            type: 'command_execution',
            id: 'cmd-1',
            command: 'rm -rf /',
            status: 'in_progress',
          },
        })
        return { status: ToolCallResponseStatus.Aborted }
      },
      { isCurrent: () => false },
    )
    await run

    expect(messages()).toEqual([])
  })

  it('drops a thrown error when the turn was superseded', async () => {
    const { messages, run } = setup(
      async () => {
        throw new Error('late failure')
      },
      { isCurrent: () => false },
    )
    await run

    expect(messages()).toEqual([])
  })

  it('forwards the abort signal so the caller can cancel the turn', async () => {
    let seenSignal: AbortSignal | undefined
    const { controller, run } = setup(async (params) => {
      seenSignal = params.signal
      return { status: ToolCallResponseStatus.Aborted }
    })
    await run

    expect(seenSignal).toBeDefined()
    expect(seenSignal?.aborted).toBe(false)
    controller.abort()
    expect(seenSignal?.aborted).toBe(true)
  })
})
