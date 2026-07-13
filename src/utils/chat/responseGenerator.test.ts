import type { BaseLLMProvider } from '../../core/llm/base'
import type { ChatMessage } from '../../types/chat'
import type { LLMResponseStreaming } from '../../types/llm/response'
import type { LLMProvider } from '../../types/provider.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import type { PromptGenerator } from './promptGenerator'
import { ResponseGenerator } from './responseGenerator'
import type { ToolDispatcher } from './tool-dispatcher'

describe('ResponseGenerator tool-call gating', () => {
  it('ignores provider tool calls when tools are disabled', async () => {
    const { callTool, generator, latestMessages, listAvailableTools } =
      createGenerator([[toolChunk('call-1', 0)]], { enableTools: false })

    await generator.run()

    expect(listAvailableTools).not.toHaveBeenCalled()
    expect(callTool).not.toHaveBeenCalled()
    expect(latestMessages()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        toolCallRequests: undefined,
      }),
    ])
  })

  it('ignores provider tool calls that were not advertised', async () => {
    const { callTool, generator, latestMessages } = createGenerator(
      [[toolChunk('call-1', 0, 'danger_tool')]],
      { advertisedToolNames: ['safe_tool'] },
    )

    await generator.run()

    expect(callTool).not.toHaveBeenCalled()
    expect(latestMessages()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        toolCallRequests: undefined,
      }),
    ])
  })

  it('revokes tool calls when tools are disabled during the response', async () => {
    let toolsEnabled = true
    const { callTool, generator, latestMessages, listAvailableTools } =
      createGenerator([[toolChunk('call-1', 0)]], {
        isToolsEnabled: () => toolsEnabled,
        onStream: () => {
          toolsEnabled = false
        },
      })

    await generator.run()

    expect(listAvailableTools).toHaveBeenCalledTimes(1)
    expect(callTool).not.toHaveBeenCalled()
    expect(latestMessages()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        toolCallRequests: undefined,
      }),
    ])
  })

  it('does not advertise tools disabled while the tool list is loading', async () => {
    let toolsEnabled = true
    const { callTool, generator, streamResponse } = createGenerator(
      [[toolChunk('call-1', 0)]],
      {
        isToolsEnabled: () => toolsEnabled,
        onListAvailableTools: () => {
          toolsEnabled = false
        },
      },
    )

    await generator.run()

    expect(streamResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tools: undefined }),
      expect.anything(),
    )
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe('ResponseGenerator auto tool call limit', () => {
  it('limits a single model batch by actual tool call count', async () => {
    const { callTool, generator, latestMessages } = createGenerator([
      [toolChunk('call-1', 0), toolChunk('call-2', 1)],
    ])

    await generator.run()

    expect(callTool).toHaveBeenCalledTimes(1)
    const toolMessage = latestMessages().find(
      (message) => message.role === 'tool',
    )
    expect(
      toolMessage?.role === 'tool' ? toolMessage.toolCalls : [],
    ).toMatchObject([
      { response: { status: ToolCallResponseStatus.Success } },
      { response: { status: ToolCallResponseStatus.PendingApproval } },
    ])
  })

  it('allows a final assistant response without executing an N+1 tool call', async () => {
    const { callTool, generator, latestMessages, streamResponse } =
      createGenerator([
        [toolChunk('call-1', 0)],
        [contentChunk('Final response'), toolChunk('call-2', 0)],
      ])

    await generator.run()

    expect(streamResponse).toHaveBeenCalledTimes(2)
    expect(callTool).toHaveBeenCalledTimes(1)
    const toolMessages = latestMessages().filter(
      (message) => message.role === 'tool',
    )
    expect(toolMessages).toHaveLength(2)
    expect(latestMessages().at(-2)).toMatchObject({
      content: 'Final response',
      role: 'assistant',
    })
    expect(
      toolMessages[1].role === 'tool'
        ? toolMessages[1].toolCalls[0].response.status
        : undefined,
    ).toBe(ToolCallResponseStatus.PendingApproval)
  })
})

describe('ResponseGenerator response bounds', () => {
  it('accumulates streamed DeepSeek reasoning metadata', async () => {
    const { generator, latestMessages } = createGenerator([
      [reasoningChunk('think '), reasoningChunk('hard'), reasoningChunk('!')],
    ])

    await generator.run()

    expect(latestMessages()[0]).toMatchObject({
      reasoning: 'think hard!',
      providerMetadata: {
        deepseek: { reasoningContent: 'think hard!' },
      },
    })
  })

  it('rejects an oversized assistant response', async () => {
    const { generator } = createGenerator([
      [contentChunk('x'.repeat(2 * 1024 * 1024 + 1))],
    ])

    await expect(generator.run()).rejects.toThrow(
      'Assistant response is too large',
    )
  })

  it('rejects oversized streamed tool arguments', async () => {
    const chunk = toolChunk('call-1', 0)
    const toolCall = chunk.choices[0]?.delta.tool_calls?.[0]
    if (!toolCall?.function) throw new Error('Expected tool call fixture')
    toolCall.function.arguments = 'x'.repeat(1024 * 1024 + 1)
    const { generator } = createGenerator([[chunk]])

    await expect(generator.run()).rejects.toThrow(
      'Assistant tool call arguments are too large',
    )
  })

  it('rejects tool call indexes outside the supported range', async () => {
    const { generator } = createGenerator([[toolChunk('call-1', 64)]])

    await expect(generator.run()).rejects.toThrow(
      'Assistant response has too many tool calls',
    )
  })

  it('rejects oversized tool call IDs', async () => {
    const { generator } = createGenerator([[toolChunk('x'.repeat(257), 0)]])

    await expect(generator.run()).rejects.toThrow(
      'Assistant tool call ID is invalid',
    )
  })

  it('rejects annotations that cannot be persisted safely', async () => {
    const chunk = contentChunk('response')
    chunk.choices[0].delta.annotations = [
      {
        type: 'url_citation',
        url_citation: { url: `https://example.com/${'x'.repeat(16_384)}` },
      },
    ]
    const { generator } = createGenerator([[chunk]])

    await expect(generator.run()).rejects.toThrow(
      'Assistant response has an invalid annotation',
    )
  })
})

function createGenerator(
  responses: LLMResponseStreaming[][],
  {
    advertisedToolNames = ['test_tool'],
    enableTools = true,
    isToolsEnabled,
    onListAvailableTools,
    onStream,
  }: {
    advertisedToolNames?: string[]
    enableTools?: boolean
    isToolsEnabled?: () => boolean
    onListAvailableTools?: () => void
    onStream?: () => void
  } = {},
) {
  let latestMessages: ChatMessage[] = []
  const streamResponse = jest.fn(async () => {
    onStream?.()
    const chunks = responses.shift() ?? []
    return (async function* () {
      yield* chunks
    })()
  })
  const callTool = jest.fn().mockResolvedValue({
    status: ToolCallResponseStatus.Success,
    data: { type: 'text', text: 'ok' },
  })
  const listAvailableTools = jest.fn(async () => {
    onListAvailableTools?.()
    return advertisedToolNames.map((name) => ({
      type: 'function' as const,
      function: {
        name,
        description: 'test tool',
        parameters: { type: 'object' as const, properties: {} },
      },
    }))
  })
  const toolDispatcher: ToolDispatcher = {
    abortToolCall: jest.fn(),
    allowToolForConversation: jest.fn(),
    callTool,
    isToolExecutionAllowed: () => true,
    listAvailableTools,
  }
  const generator = new ResponseGenerator({
    conversationId: 'conversation-1',
    enableTools,
    isToolsEnabled,
    maxAutoIterations: 1,
    messages: [],
    model: {
      id: 'model-1',
      model: 'gpt-test',
      providerId: 'provider-1',
      providerType: 'openai',
    },
    promptGenerator: {
      generateRequestMessages: jest.fn().mockResolvedValue([]),
    } as unknown as PromptGenerator,
    providerClient: {
      streamResponse,
    } as unknown as BaseLLMProvider<LLMProvider>,
    toolDispatcher,
  })
  generator.subscribe((messages) => {
    latestMessages = messages
  })
  return {
    callTool,
    generator,
    latestMessages: () => latestMessages,
    listAvailableTools,
    streamResponse,
  }
}

function contentChunk(content: string): LLMResponseStreaming {
  return {
    choices: [{ delta: { content }, finish_reason: null }],
    id: 'response-content',
    model: 'gpt-test',
    object: 'chat.completion.chunk',
  }
}

function reasoningChunk(reasoning: string): LLMResponseStreaming {
  return {
    choices: [
      {
        delta: {
          reasoning,
          providerMetadata: { deepseek: { reasoningContent: reasoning } },
        },
        finish_reason: null,
      },
    ],
    id: 'response-reasoning',
    model: 'deepseek-test',
    object: 'chat.completion.chunk',
  }
}

function toolChunk(
  id: string,
  index: number,
  name = 'test_tool',
): LLMResponseStreaming {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              function: { arguments: '{}', name },
              id,
              index,
              type: 'function',
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    id: `response-${id}`,
    model: 'gpt-test',
    object: 'chat.completion.chunk',
  }
}
