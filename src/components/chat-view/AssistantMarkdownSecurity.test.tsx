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
import { UntrustedMarkdown } from './UntrustedMarkdown'

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
        messageId="assistant-1"
        getContextMessages={() => []}
        handleApply={jest.fn()}
        applyingBlockId={null}
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

  it('does not auto-load images from untrusted markdown', () => {
    renderToStaticMarkup(
      <UntrustedMarkdown content="![tracking pixel](https://attacker.invalid/pixel)" />,
    )
    const ImageComponent = ReactMarkdown.mock.calls[0][0].components.img
    const remoteImage = renderToStaticMarkup(
      <ImageComponent
        src="https://attacker.invalid/pixel"
        alt="tracking pixel"
      />,
    )
    const unsafeImage = renderToStaticMarkup(
      <ImageComponent src="data:image/svg+xml,payload" alt="payload" />,
    )

    expect(remoteImage).not.toContain('<img')
    expect(remoteImage).toContain('Remote image blocked: tracking pixel')
    expect(remoteImage).toContain('rel="noopener noreferrer"')
    expect(unsafeImage).not.toContain('<a')
    expect(unsafeImage).toContain('Image blocked: payload')
  })

  it('renders a large streaming response as raw text until completion', () => {
    const payload = `\`\`\`typescript\n${'const value = 1\\n'.repeat(8_000)}`

    const html = renderToStaticMarkup(
      <AssistantMarkdownContent
        content={payload}
        messageId="assistant-streaming"
        getContextMessages={() => []}
        handleApply={jest.fn()}
        applyingBlockId={null}
        isStreaming
      />,
    )

    expect(html).toContain('smtcmp-streaming-response')
    expect(html).toContain('const value = 1')
    expect(ReactMarkdown).not.toHaveBeenCalled()
  })

  it('shows model-provided edit blocks as raw text by default', () => {
    const payload =
      '```dataviewjs\napp.vault.create("pwned.md", "executed")\n```'

    const html = renderToStaticMarkup(
      <MarkdownCodeComponent
        applyId="assistant-1:0"
        onApply={jest.fn()}
        applyingBlockId={null}
        language="markdown"
      >
        {payload}
      </MarkdownCodeComponent>,
    )

    expect(html).toContain('View Formatted')
    expect(html).toContain('app.vault.create')
    expect(ObsidianMarkdown).not.toHaveBeenCalled()
  })

  it('skips syntax highlighting for oversized completed code blocks', () => {
    const payload = `const value = "${'x'.repeat(128 * 1024)}"`

    const html = renderToStaticMarkup(
      <MarkdownCodeComponent
        applyId="assistant-large:0"
        onApply={jest.fn()}
        applyingBlockId={null}
        language="typescript"
      >
        {payload}
      </MarkdownCodeComponent>,
    )

    expect(html).toContain('smtcmp-code-block-plain')
    expect(html).toContain('const value')
    expect(html).toContain('<span>Apply</span>')
  })

  it('labels only the active code block as applying', () => {
    const inactiveHtml = renderToStaticMarkup(
      <MarkdownCodeComponent
        applyId="assistant-1:0"
        applyingBlockId="assistant-1:1"
        onApply={jest.fn()}
      >
        first block
      </MarkdownCodeComponent>,
    )
    const activeHtml = renderToStaticMarkup(
      <MarkdownCodeComponent
        applyId="assistant-1:1"
        applyingBlockId="assistant-1:1"
        onApply={jest.fn()}
      >
        second block
      </MarkdownCodeComponent>,
    )

    expect(inactiveHtml).toContain('<span>Apply</span>')
    expect(inactiveHtml).not.toContain('Applying...')
    expect(activeHtml).toContain('Applying...')
  })
})
