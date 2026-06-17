import { renderToStaticMarkup } from 'react-dom/server'

import { AgentChatButton } from './AgentChatButton'

describe('AgentChatButton', () => {
  it('renders the Agent submit action', () => {
    const html = renderToStaticMarkup(<AgentChatButton onClick={jest.fn()} />)

    expect(html).toContain('&gt;_ Agent')
  })
})
