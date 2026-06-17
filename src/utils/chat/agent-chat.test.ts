import type { TFile } from 'obsidian'

import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import type { ChatUserMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import {
  AGENT_CHAT_CONTEXT_HEADING,
  buildAgentAssistantMessage,
  buildAgentChatMessages,
  buildAgentChatRequestArgs,
  buildAgentChatToolMessage,
  buildAgentCommandMessageFromEvent,
  buildAgentPrompt,
  getRunningAgentChatToolCallIds,
  isAgentChatToolMessage,
  upsertAgentCommandMessage,
  withCurrentFileMentionable,
} from './agent-chat'

describe('buildAgentChatToolMessage', () => {
  it('creates a pending Codex tool call for an unapproved Agent Chat request', () => {
    const toolMessage = buildAgentChatToolMessage({
      conversationId: 'conversation-1',
      prompt: 'Inspect the project and summarize the risky files.',
      isExecutionAllowed: () => false,
    })

    expect(toolMessage.role).toBe('tool')
    expect(toolMessage.toolCalls).toHaveLength(1)
    expect(toolMessage.toolCalls[0].request.name).toBe(CODEX_TOOL_NAME)
    expect(
      JSON.parse(toolMessage.toolCalls[0].request.arguments ?? '{}'),
    ).toEqual({
      prompt: 'Inspect the project and summarize the risky files.',
      summary: 'Agent Chat',
    })
    expect(toolMessage.toolCalls[0].response.status).toBe(
      ToolCallResponseStatus.PendingApproval,
    )
  })

  it('creates a running Codex tool call for an allowed Agent Chat request', () => {
    const toolMessage = buildAgentChatToolMessage({
      conversationId: 'conversation-1',
      prompt: 'Run the configured agent task.',
      isExecutionAllowed: () => true,
    })

    expect(toolMessage.toolCalls[0].response.status).toBe(
      ToolCallResponseStatus.Running,
    )
  })

  it('does not treat malformed Codex arguments as an Agent Chat result', () => {
    expect(
      isAgentChatToolMessage({
        id: 'tool-message-1',
        role: 'tool',
        toolCalls: [
          {
            request: {
              id: 'tool-call-1',
              name: CODEX_TOOL_NAME,
              arguments: '{',
            },
            response: {
              status: ToolCallResponseStatus.Running,
            },
          },
        ],
      }),
    ).toBe(false)
  })

  it('does not treat mixed or empty tool calls as an Agent Chat result', () => {
    const toolMessage = buildAgentChatToolMessage({
      conversationId: 'conversation-1',
      prompt: 'Inspect the project.',
      isExecutionAllowed: () => true,
    })

    expect(
      isAgentChatToolMessage({
        id: 'empty-tool-message',
        role: 'tool',
        toolCalls: [],
      }),
    ).toBe(false)
    expect(
      isAgentChatToolMessage({
        ...toolMessage,
        toolCalls: [
          ...toolMessage.toolCalls,
          {
            request: {
              id: 'regular-tool-call',
              name: 'regular_tool',
            },
            response: {
              status: ToolCallResponseStatus.Running,
            },
          },
        ],
      }),
    ).toBe(false)
  })

  it('pairs the Agent Chat tool result with an assistant tool-call request', () => {
    const messages = buildAgentChatMessages({
      conversationId: 'conversation-1',
      prompt: 'Inspect the project and summarize the risky files.',
      isExecutionAllowed: () => false,
    })

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].toolCallRequests).toHaveLength(1)
    expect(messages[1].role).toBe('tool')
    expect(messages[1].toolCalls[0].request).toEqual(
      messages[0].toolCallRequests?.[0],
    )
  })

  it('finds only running Agent Chat tool calls', () => {
    const runningAgentToolMessage = buildAgentChatToolMessage({
      conversationId: 'conversation-1',
      prompt: 'Inspect the project.',
      isExecutionAllowed: () => true,
    })
    const finishedAgentToolMessage = buildAgentChatToolMessage({
      conversationId: 'conversation-1',
      prompt: 'Summarize the result.',
      isExecutionAllowed: () => true,
    })
    finishedAgentToolMessage.toolCalls[0].response = {
      status: ToolCallResponseStatus.Success,
      data: {
        type: 'text',
        text: 'Done',
      },
    }

    expect(
      getRunningAgentChatToolCallIds([
        runningAgentToolMessage,
        finishedAgentToolMessage,
        {
          id: 'regular-tool-message',
          role: 'tool',
          toolCalls: [
            {
              request: {
                id: 'regular-tool-call',
                name: 'regular_tool',
              },
              response: {
                status: ToolCallResponseStatus.Running,
              },
            },
          ],
        },
      ]),
    ).toEqual([runningAgentToolMessage.toolCalls[0].request.id])
  })
})

describe('buildAgentChatRequestArgs', () => {
  it('creates hidden Codex request args for direct Agent Chat execution', () => {
    // Given: an Agent Chat prompt should run without adding a visible tool call.
    const prompt = 'Inspect the active note.'

    // When: the Codex request args are built.
    const args = buildAgentChatRequestArgs(prompt)

    // Then: the request is still identifiable as Agent Chat for compatibility.
    expect(JSON.parse(args)).toEqual({
      prompt,
      summary: 'Agent Chat',
    })
  })
})

describe('buildAgentAssistantMessage', () => {
  it('creates a normal assistant message for Agent Chat output', () => {
    // Given: Codex returned final text.
    const output = 'I checked the project.'

    // When: the UI message is built.
    const message = buildAgentAssistantMessage(output)

    // Then: the result renders through the normal assistant path.
    expect(message.role).toBe('assistant')
    expect(message.content).toBe(output)
    expect(message.toolCallRequests).toBeUndefined()
  })
})

describe('buildAgentPrompt', () => {
  it('includes the current markdown file path when one is open', () => {
    // Given: the user sends Agent Chat while a markdown note is active.
    const file = {
      extension: 'md',
      path: 'Projects/Plan.md',
    } as TFile

    // When: the prompt is prepared for Codex.
    const userMessage: ChatUserMessage = {
      role: 'user',
      content: null,
      promptContent: 'Summarize this note.',
      id: 'user-1',
      mentionables: [{ type: 'current-file', file }],
    }
    const prompt = buildAgentPrompt({
      messages: [userMessage],
      prompt: 'Summarize this note.',
      userMessage,
    })

    // Then: Codex receives the active markdown path explicitly.
    expect(prompt).toContain(AGENT_CHAT_CONTEXT_HEADING)
    expect(prompt).toContain('Path: Projects/Plan.md')
    expect(prompt).toContain('Summarize this note.')
  })

  it('omits the current file path when the active file is not markdown', () => {
    // Given: the active file is not a markdown note.
    const file = {
      extension: 'png',
      path: 'Images/diagram.png',
    } as TFile

    // When: the prompt is prepared for Codex.
    const userMessage: ChatUserMessage = {
      role: 'user',
      content: null,
      promptContent: 'Inspect the project.',
      id: 'user-1',
      mentionables: [{ type: 'current-file', file }],
    }
    const prompt = buildAgentPrompt({
      messages: [userMessage],
      prompt: 'Inspect the project.',
      userMessage,
    })

    // Then: no misleading active markdown note context is sent.
    expect(prompt).not.toContain(AGENT_CHAT_CONTEXT_HEADING)
    expect(prompt).not.toContain('Path: Images/diagram.png')
    expect(prompt).toContain('Inspect the project.')
  })
})

describe('withCurrentFileMentionable', () => {
  it('adds the current file mentionable when the user message has no toggle', () => {
    // Given: an older or edited user message has no current-file mentionable.
    const file = {
      extension: 'md',
      path: 'Daily/Today.md',
    } as TFile

    // When: Agent Chat refreshes current note context before submit.
    const message = withCurrentFileMentionable(
      {
        role: 'user',
        content: null,
        promptContent: 'Read the current note.',
        id: 'user-1',
        mentionables: [],
      },
      file,
    )

    // Then: the active file is included for prompt construction.
    expect(message.mentionables).toEqual([{ type: 'current-file', file }])
  })
})

describe('buildAgentCommandMessageFromEvent', () => {
  it('maps Codex command execution events to visible command messages', () => {
    const message = buildAgentCommandMessageFromEvent({
      kind: 'item.completed',
      line: 1,
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: "/bin/bash -lc 'rg --files'",
        aggregated_output: 'package.json\n',
        exit_code: 0,
        status: 'completed',
      },
    })

    expect(message).toEqual({
      role: 'agent-command',
      id: 'agent-command:item_0',
      command: "/bin/bash -lc 'rg --files'",
      output: 'package.json\n',
      exitCode: 0,
      status: 'success',
    })
  })

  it('keeps running command events open until completion', () => {
    const message = buildAgentCommandMessageFromEvent({
      kind: 'item.started',
      line: 1,
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/bash -lc pwd',
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    })

    expect(message?.status).toBe('running')
  })
})

describe('upsertAgentCommandMessage', () => {
  it('updates the existing command message instead of appending duplicates', () => {
    const runningMessage = buildAgentCommandMessageFromEvent({
      kind: 'item.started',
      line: 1,
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/bash -lc pwd',
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    })
    const completedMessage = buildAgentCommandMessageFromEvent({
      kind: 'item.completed',
      line: 2,
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/bash -lc pwd',
        aggregated_output: '/home/youill0317/Aider\n',
        exit_code: 0,
        status: 'completed',
      },
    })

    expect(runningMessage).not.toBeNull()
    expect(completedMessage).not.toBeNull()
    if (!runningMessage || !completedMessage) {
      throw new Error('expected command messages')
    }

    const messages = upsertAgentCommandMessage(
      upsertAgentCommandMessage([], runningMessage),
      completedMessage,
    )

    expect(messages).toEqual([completedMessage])
  })
})
