import { renderToStaticMarkup } from 'react-dom/server'

import { ToolCallResponseStatus } from '../../types/tool-call.types'

import ToolActivityGroup from './ToolActivityGroup'

jest.mock('./ToolMessage', () => ({
  __esModule: true,
  default: () => <div>original-tool-message</div>,
}))

jest.mock('./AgentCommandMessage', () => ({
  __esModule: true,
  default: () => <div>original-agent-command-message</div>,
}))

jest.mock('./ObsidianMarkdown', () => ({
  ObsidianCodeBlock: ({ content }: { content: string }) => <pre>{content}</pre>,
}))

describe('ToolActivityGroup', () => {
  it('renders successful completed activity as one collapsed summary row', () => {
    const html = renderToStaticMarkup(
      <ToolActivityGroup
        conversationId="conversation-1"
        onToolMessageUpdate={jest.fn()}
        messages={[
          {
            id: 'message-1',
            role: 'tool',
            toolCalls: [
              {
                request: {
                  id: 'tool-1',
                  name: 'github__search',
                  arguments: JSON.stringify({ query: 'smart composer' }),
                },
                response: {
                  status: ToolCallResponseStatus.Success,
                  data: { type: 'text', text: 'ok' },
                },
              },
              {
                request: {
                  id: 'tool-2',
                  name: 'read_file',
                  arguments: JSON.stringify({ path: 'notes/today.md' }),
                },
                response: {
                  status: ToolCallResponseStatus.Success,
                  data: { type: 'text', text: 'ok' },
                },
              },
            ],
          },
        ]}
      />,
    )

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Used 2 tools: github:search, read_file')
    expect(html).not.toContain('Result:')
  })

  it('keeps active tool calls in the original actionable renderer', () => {
    const html = renderToStaticMarkup(
      <ToolActivityGroup
        conversationId="conversation-1"
        onToolMessageUpdate={jest.fn()}
        messages={[
          {
            id: 'message-1',
            role: 'tool',
            toolCalls: [
              {
                request: {
                  id: 'tool-1',
                  name: 'github__search',
                },
                response: {
                  status: ToolCallResponseStatus.PendingApproval,
                },
              },
            ],
          },
        ]}
      />,
    )

    expect(html).toContain('original-tool-message')
  })
})
