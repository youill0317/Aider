import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { getToolMessageContent } from './ToolMessage'

jest.mock('../../contexts/settings-context', () => ({
  useSettings: () => ({
    setSettings: jest.fn(),
    settings: {
      mcp: {
        servers: [],
      },
    },
  }),
}))

jest.mock('../../contexts/tool-dispatcher-context', () => ({
  useToolDispatcher: () => ({
    getToolDispatcher: async () => ({
      abortToolCall: jest.fn(),
      allowToolForConversation: jest.fn(),
      callTool: jest.fn(),
    }),
  }),
}))

jest.mock('./ObsidianMarkdown', () => ({
  ObsidianCodeBlock: () => null,
}))

describe('getToolMessageContent', () => {
  it('displays Codex tool calls with the compact agent symbol', () => {
    const content = getToolMessageContent({
      id: 'tool-message-1',
      role: 'tool',
      toolCalls: [
        {
          request: {
            id: 'tool-call-1',
            name: CODEX_TOOL_NAME,
            arguments: JSON.stringify({
              prompt: 'Inspect the project',
              summary: 'Agent Chat',
            }),
          },
          response: {
            status: ToolCallResponseStatus.Success,
            data: {
              type: 'text',
              text: 'Codex inspected the project.',
            },
          },
        },
      ],
    })

    expect(content).toContain('Called >_')
    expect(content).toContain('"summary":"Agent Chat"')
    expect(content).not.toContain(`Called ${CODEX_TOOL_NAME}`)
  })

  it('keeps regular tool call names unchanged', () => {
    const content = getToolMessageContent({
      id: 'tool-message-1',
      role: 'tool',
      toolCalls: [
        {
          request: {
            id: 'tool-call-1',
            name: 'github__search',
            arguments: JSON.stringify({
              query: 'smart composer',
            }),
          },
          response: {
            status: ToolCallResponseStatus.PendingApproval,
          },
        },
      ],
    })

    expect(content).toContain('Call github:search')
    expect(content).not.toContain('Call >_')
  })
})
