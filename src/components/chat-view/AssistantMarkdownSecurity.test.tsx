import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return { __esModule: true, ...React, default: React }
})

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: jest.fn(
    ({ children, className }: { children: string; className: string }) => (
      <div className={className}>{children}</div>
    ),
  ),
}))

jest.mock('../../contexts/app-context', () => ({
  useApp: () => ({}),
}))

jest.mock('../../contexts/dark-mode-context', () => ({
  useDarkModeContext: () => ({ isDarkMode: false }),
}))

jest.mock('../../utils/obsidian', () => ({
  openMarkdownFile: jest.fn(),
}))

jest.mock('./ObsidianMarkdown', () => ({
  ObsidianMarkdown: jest.fn(({ content }: { content: string }) => (
    <div>{content}</div>
  )),
}))

jest.mock('./SyntaxHighlighterWrapper', () => ({
  MemoizedSyntaxHighlighterWrapper: ({ children }: { children: string }) => (
    <pre>{children}</pre>
  ),
}))

import AssistantMarkdownContent from './AssistantMessageContent'
import AssistantMessageReasoning from './AssistantMessageReasoning'
import MarkdownCodeComponent from './MarkdownCodeComponent'

const ReactMarkdown = jest.requireMock<{ default: jest.Mock }>(
  'react-markdown',
).default
const React = jest.requireMock<typeof import('react')>('react')
const { ObsidianMarkdown } = jest.requireMock<{
  ObsidianMarkdown: jest.Mock
}>('./ObsidianMarkdown')

describe('untrusted assistant markdown', () => {
  beforeEach(() => {
    ReactMarkdown.mockClear()
    ObsidianMarkdown.mockClear()
  })

  it('renders assistant content without the Obsidian renderer', () => {
    const payload =
      'hello\n\n```poc-exec\nvault.read(\'/private.md\')\n```\n<iframe src="https://attacker.invalid"></iframe>'

    const html = renderToStaticMarkup(
      <AssistantMarkdownContent
        content={payload}
        getContextMessages={() => []}
        handleApply={jest.fn()}
        isApplying={false}
      />,
    )

    expect(html).toContain('vault.read(&#x27;/private.md&#x27;)')
    expect(ReactMarkdown.mock.calls[0][0]).toEqual(
      expect.objectContaining({ children: payload, skipHtml: true }),
    )
    expect(ObsidianMarkdown).not.toHaveBeenCalled()
  })

  it('renders expanded reasoning without the Obsidian renderer', () => {
    const useState = jest.spyOn(React, 'useState') as jest.Mock
    useState
      .mockReturnValueOnce([true, jest.fn()])
      .mockReturnValueOnce([false, jest.fn()])

    try {
      renderToStaticMarkup(
        <AssistantMessageReasoning reasoning={'```poc-exec\nrun()\n```'} />,
      )
    } finally {
      useState.mockRestore()
    }

    expect(ReactMarkdown.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        children: '```poc-exec\nrun()\n```',
        skipHtml: true,
      }),
    )
    expect(ObsidianMarkdown).not.toHaveBeenCalled()
  })

  it('shows model-provided edit blocks as raw text by default', () => {
    const payload =
      '```dataviewjs\napp.vault.create("pwned.md", "executed")\n```'

    const html = renderToStaticMarkup(
      <MarkdownCodeComponent
        onApply={jest.fn()}
        isApplying={false}
        language="markdown"
      >
        {payload}
      </MarkdownCodeComponent>,
    )

    expect(html).toContain('View Formatted')
    expect(html).toContain('app.vault.create')
    expect(ObsidianMarkdown).not.toHaveBeenCalled()
  })
})
