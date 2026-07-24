import { renderToStaticMarkup } from 'react-dom/server'

import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import ToolMessage, {
  ToolApprovalAction,
  getToolMessageContent,
  runToolApprovalAction,
} from './ToolMessage'

jest.mock('clsx', () => ({
  __esModule: true,
  default: (...values: unknown[]) => values.filter(Boolean).join(' '),
}))

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

describe('runToolApprovalAction', () => {
  const request = {
    id: 'permission-1',
    name: CODEX_TOOL_NAME,
  }

  it.each<ToolApprovalAction>([
    'allow',
    'allow-for-conversation',
    'reject',
    'cancel',
  ])('routes %s through the inner approval adapter', (action) => {
    const adapter = jest.fn()
    const fallback = jest.fn()

    runToolApprovalAction(adapter, action, request, fallback)

    expect(adapter).toHaveBeenCalledWith(action, request)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('preserves the existing tool action when no adapter is provided', async () => {
    const fallback = jest.fn().mockResolvedValue(undefined)

    await runToolApprovalAction(undefined, 'allow', request, fallback)

    expect(fallback).toHaveBeenCalledTimes(1)
  })
})

describe('Codex approval actions', () => {
  it('shows only decisions offered by Codex', () => {
    const html = renderToStaticMarkup(
      <ToolMessage
        message={{
          id: 'permission-message',
          role: 'tool',
          toolCalls: [
            {
              request: {
                id: 'permission-1',
                name: CODEX_TOOL_NAME,
              },
              response: {
                status: ToolCallResponseStatus.PendingApproval,
              },
            },
          ],
        }}
        conversationId="conversation-1"
        executeToolCall={async () => undefined}
        abortToolCall={() => undefined}
        onToolCallResponseUpdate={() => undefined}
        approvalActionAdapter={() => undefined}
        approvalActions={['cancel', 'reject']}
      />,
    )

    expect(html).not.toContain('Allow')
    expect(html).toContain('Reject')
    expect(html).toContain('Abort')
  })
})
