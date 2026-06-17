import { buildAgentChatMessages, buildAgentPrompt } from './agent-chat'
import {
  agentCommand,
  assistant,
  completedAgentMessages,
  createRequestMessages,
  extractAssistantText,
  extractUserText,
  getCodexToolIndex,
  user,
} from './agent-chat-user-scenarios.test-utils'

describe('Agent Chat user journeys', () => {
  it('preserves context when a user alternates vault chat, Agent Chat, and normal chat', async () => {
    const requestMessages = await createRequestMessages([
      user('Can you explain this plugin structure?', 'user-normal'),
      assistant('It is an Obsidian plugin.', 'assistant-normal'),
      user('Summarize the selected vault note.', 'user-vault'),
      assistant(
        'The vault note describes the chat architecture.',
        'assistant-vault',
      ),
      user('Now inspect the project files that implement it.', 'user-agent'),
      ...completedAgentMessages('Codex found Chat.tsx and ToolMessage.tsx.'),
      user('Explain how those files relate to the vault note.', 'user-normal'),
    ])

    expect(extractUserText(requestMessages)).toEqual([
      'Can you explain this plugin structure?',
      'Summarize the selected vault note.',
      'Now inspect the project files that implement it.',
      'Explain how those files relate to the vault note.',
    ])
    expect(extractAssistantText(requestMessages)).toContain(
      'The vault note describes the chat architecture.',
    )
    expect(getCodexToolIndex(requestMessages)).toBeGreaterThan(-1)
  })

  it('preserves multiple Agent Chat results across one conversation', async () => {
    const firstAgentMessages = completedAgentMessages(
      'Codex inspected the settings flow.',
      'settings',
    )
    const secondAgentMessages = completedAgentMessages(
      'Codex inspected the chat UI flow.',
      'chat-ui',
    )
    const requestMessages = await createRequestMessages([
      user('Inspect settings first.', 'user-agent-settings'),
      ...firstAgentMessages,
      user('Now inspect the chat UI.', 'user-agent-ui'),
      ...secondAgentMessages,
      user('Compare both findings.', 'user-follow-up'),
    ])
    const codexToolMessages = requestMessages.filter(
      (message) =>
        message.role === 'tool' && message.tool_call.name === 'run_codex',
    )

    expect(codexToolMessages).toHaveLength(2)
    expect(requestMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Compare both findings.',
        role: 'user',
      }),
    )
  })

  it('keeps an unfinished Agent Chat request in history when the user continues normally', async () => {
    const [runningAssistantMessage, runningToolMessage] =
      buildAgentChatMessages({
        conversationId: 'conversation-1',
        isExecutionAllowed: () => true,
        prompt: 'Inspect the project.',
      })
    const [pendingAssistantMessage, pendingToolMessage] =
      buildAgentChatMessages({
        conversationId: 'conversation-1',
        isExecutionAllowed: () => false,
        prompt: 'Inspect the vault.',
      })
    const requestMessages = await createRequestMessages([
      user('Inspect the project.', 'user-agent'),
      runningAssistantMessage,
      runningToolMessage,
      user('Inspect the vault too.', 'user-agent-pending'),
      pendingAssistantMessage,
      pendingToolMessage,
      user('Answer from the existing context instead.', 'user-follow-up'),
    ])
    const toolMessages = requestMessages.filter(
      (message) =>
        message.role === 'tool' && message.tool_call.name === 'run_codex',
    )

    expect(toolMessages.map((message) => message.content)).toEqual([
      expect.stringContaining('running'),
      expect.stringContaining('pending_approval'),
    ])
    expect(requestMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: 'Answer from the existing context instead.',
        role: 'user',
      }),
    )
  })

  it('keeps all messages from the last 10 user turns', async () => {
    const messages = [
      ...Array.from({ length: 11 }, (_, index) => [
        user(`Normal question ${index + 1}`, `user-${index + 1}`),
        assistant(`Normal answer ${index + 1}`, `assistant-${index + 1}`),
      ]).flat(),
      user('Inspect the project.', 'user-agent'),
      agentCommand({
        command: '/bin/bash -lc pwd',
        id: 'pwd',
        output: '/home/youill0317/Aider\n',
      }),
      agentCommand({
        command: "/bin/bash -lc 'rg --files -g package.json'",
        id: 'rg',
        output: 'package.json\n',
      }),
      assistant('Codex found the package file.', 'assistant-agent'),
      user('Continue from that result.', 'user-follow-up'),
    ]

    const requestMessages = await createRequestMessages(messages)

    expect(extractUserText(requestMessages)).toEqual([
      'Normal question 4',
      'Normal question 5',
      'Normal question 6',
      'Normal question 7',
      'Normal question 8',
      'Normal question 9',
      'Normal question 10',
      'Normal question 11',
      'Inspect the project.',
      'Continue from that result.',
    ])
    expect(extractAssistantText(requestMessages)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('>_ /bin/bash -lc pwd'),
        expect.stringContaining(
          ">_ /bin/bash -lc 'rg --files -g package.json'",
        ),
        'Codex found the package file.',
      ]),
    )
  })

  it('builds Agent Chat prompts from the last 10 user turns', () => {
    const followUpUser = user(
      'Continue from the previous agent result.',
      'user-agent-follow-up',
    )

    const prompt = buildAgentPrompt({
      messages: [
        user('Explain the plugin structure first.', 'user-normal'),
        assistant(
          'The chat UI is coordinated by Chat.tsx.',
          'assistant-normal',
        ),
        user('Inspect the files with Codex.', 'user-agent'),
        agentCommand({
          command: "rg -n 'handleUserMessageSubmit' src/components",
          id: 'rg-submit',
          output: 'src/components/chat-view/Chat.tsx:294\n',
        }),
        assistant('Codex found the submit path.', 'assistant-agent'),
        followUpUser,
      ],
      prompt: 'Continue from the previous agent result.',
      userMessage: followUpUser,
    })

    expect(prompt).toContain('Explain the plugin structure first.')
    expect(prompt).toContain('The chat UI is coordinated by Chat.tsx.')
    expect(prompt).toContain(
      ">_ rg -n 'handleUserMessageSubmit' src/components",
    )
    expect(prompt).toContain('src/components/chat-view/Chat.tsx:294')
    expect(prompt).toContain('Codex found the submit path.')
    expect(prompt).toContain('Continue from the previous agent result.')
  })
})
