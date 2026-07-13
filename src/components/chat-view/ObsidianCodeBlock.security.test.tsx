import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return { __esModule: true, ...React, default: React }
})

jest.mock('obsidian', () => ({
  Keymap: { isModEvent: jest.fn() },
  MarkdownRenderer: { render: jest.fn() },
}))

import { ObsidianCodeBlock } from './ObsidianMarkdown'

const markdownRenderMock = jest.requireMock<{
  MarkdownRenderer: { render: jest.Mock }
}>('obsidian').MarkdownRenderer.render

describe('ObsidianCodeBlock', () => {
  it('renders untrusted tool text without the Obsidian Markdown pipeline', () => {
    const payload =
      '```\n<iframe src="https://attacker.invalid"></iframe>\n```dataviewjs\nrun()'

    const html = renderToStaticMarkup(
      <ObsidianCodeBlock content={payload} language="json" />,
    )

    expect(html).toContain('&lt;iframe')
    expect(html).toContain('```dataviewjs')
    expect(markdownRenderMock).not.toHaveBeenCalled()
  })
})
