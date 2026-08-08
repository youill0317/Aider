import { renderToStaticMarkup } from 'react-dom/server'

import { AgentChatButton } from './AgentChatButton'

describe('AgentChatButton', () => {
  it('renders the Agent submit action', () => {
    const html = renderToStaticMarkup(<AgentChatButton onClick={jest.fn()} />)

    expect(html).toContain('Agent')
    expect(html).not.toContain('&gt;_')
    expect(html).not.toContain('Ctrl+↵')
  })

  it('explains when Agent is unavailable', () => {
    const html = renderToStaticMarkup(
      <AgentChatButton onClick={jest.fn()} disabled />,
    )

    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/<button\b[^>]*\sdisabled(?:=|(?=[\s>]))/)
    expect(html).toContain('Agent unavailable')
  })
})
