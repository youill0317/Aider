import { renderToStaticMarkup } from 'react-dom/server'

import ToolBadge from './ToolBadge'

jest.mock('clsx', () => ({
  __esModule: true,
  default: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

jest.mock('../../../contexts/app-context', () => ({
  useApp: () => ({}),
}))

jest.mock('../../../contexts/mcp-context', () => ({
  useMcp: () => ({ getMcpManager: jest.fn() }),
}))

jest.mock('../../../contexts/plugin-context', () => ({
  usePlugin: () => ({}),
}))

jest.mock('../../../contexts/settings-context', () => ({
  useSettings: () => ({
    settings: { chatOptions: { enableTools: false } },
    setSettings: jest.fn(),
  }),
}))

jest.mock('../../modals/McpSectionModal', () => ({
  McpSectionModal: jest.fn(),
}))

describe('ToolBadge', () => {
  it('keeps the tools toggle visible when tools are disabled', () => {
    const html = renderToStaticMarkup(<ToolBadge />)

    expect(html).toContain('aria-label="Enable tools"')
  })
})
