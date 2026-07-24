const mockEffectCleanups: (() => void)[] = []
let mockOnUpload: ((files: File[]) => Promise<void>) | undefined
let mockOnCreateImageMentionables:
  | ((images: import('../../../types/mentionable').MentionableImage[]) => void)
  | undefined
let mockInputHandle:
  | {
      addMentionable: (
        mentionable: import('../../../types/mentionable').Mentionable,
      ) => void
    }
  | undefined
const mockConvertFilesToMentionableImages = jest.fn()
const mockSyntaxHighlighter = jest.fn(({ children }: { children: string }) => (
  <pre>{children}</pre>
))
let mockQueryData: string | null = null

jest.mock('react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    ...React,
    useCallback: jest.fn((callback: unknown) => callback),
    useEffect: jest.fn((effect: () => undefined | (() => undefined)) => {
      const cleanup = effect()
      if (cleanup) mockEffectCleanups.push(cleanup)
    }),
    useImperativeHandle: jest.fn(
      (_ref: unknown, createHandle: () => typeof mockInputHandle) => {
        mockInputHandle = createHandle()
      },
    ),
    useMemo: jest.fn((factory: () => unknown) => factory()),
    useRef: jest.fn((value: unknown) => ({ current: value })),
    useState: jest.fn((initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      jest.fn(),
    ]),
  }
})

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockQueryData }),
}))

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  Platform: { isDesktop: false },
}))

jest.mock('../../../contexts/app-context', () => ({
  useApp: () => ({ vault: {} }),
}))

jest.mock('../../../contexts/dark-mode-context', () => ({
  useDarkModeContext: () => ({ isDarkMode: false }),
}))

jest.mock('../../../contexts/settings-context', () => ({
  useSettings: () => ({
    settings: { agent: { codex: { enabled: false } } },
  }),
}))

jest.mock('../../../utils/llm/image', () => ({
  convertFilesToMentionableImages: mockConvertFilesToMentionableImages,
}))

jest.mock('../SyntaxHighlighterWrapper', () => ({
  MemoizedSyntaxHighlighterWrapper: mockSyntaxHighlighter,
}))

jest.mock('./AgentChatButton', () => ({
  AgentChatButton: () => null,
}))

jest.mock('./ImageUploadButton', () => ({
  ImageUploadButton: ({
    onUpload,
  }: {
    onUpload: (files: File[]) => Promise<void>
  }) => {
    mockOnUpload = onUpload
    return null
  },
}))

jest.mock('./LexicalContentEditable', () => ({
  __esModule: true,
  default: ({
    onCreateImageMentionables,
  }: {
    onCreateImageMentionables: (
      images: import('../../../types/mentionable').MentionableImage[],
    ) => void
  }) => {
    mockOnCreateImageMentionables = onCreateImageMentionables
    return null
  },
}))

jest.mock('./MentionableBadge', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('./ModelSelect', () => ({
  ModelSelect: () => null,
}))

jest.mock('./SubmitButton', () => ({
  SubmitButton: () => null,
}))

jest.mock('./ToolBadge', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('./VaultChatButton', () => ({
  VaultChatButton: () => null,
}))

import { renderToStaticMarkup } from 'react-dom/server'

import { Mentionable, MentionableImage } from '../../../types/mentionable'

import ChatUserInput from './ChatUserInput'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function image(name: string): MentionableImage {
  return {
    type: 'image',
    name,
    mimeType: 'image/png',
    data: `data:image/png;base64,${name}`,
  }
}

function renderInput(setMentionables: (mentionables: Mentionable[]) => void) {
  renderToStaticMarkup(
    <ChatUserInput
      initialSerializedEditorState={null}
      onChange={jest.fn()}
      onSubmit={jest.fn()}
      onFocus={jest.fn()}
      mentionables={[]}
      setMentionables={setMentionables}
    />,
  )
}

describe('ChatUserInput async image lifecycle', () => {
  beforeEach(() => {
    mockEffectCleanups.length = 0
    mockOnUpload = undefined
    mockOnCreateImageMentionables = undefined
    mockInputHandle = undefined
    mockConvertFilesToMentionableImages.mockReset()
    mockSyntaxHighlighter.mockClear()
    mockQueryData = null
  })

  it('does not attach a conversion that finishes after input replacement', async () => {
    const conversion = deferred<{
      images: MentionableImage[]
      rejected: { name: string; reason: string }[]
    }>()
    mockConvertFilesToMentionableImages.mockReturnValue(conversion.promise)
    const setMentionables = jest.fn()
    renderInput(setMentionables)

    const upload = mockOnUpload?.([{} as File])
    mockEffectCleanups.forEach((cleanup) => cleanup())
    conversion.resolve({ images: [image('old-draft')], rejected: [] })
    await upload

    expect(setMentionables).not.toHaveBeenCalled()
  })

  it('retains both image batches when conversions finish in reverse order', () => {
    const updates: Mentionable[][] = []
    renderInput((mentionables) => updates.push(mentionables))

    mockOnCreateImageMentionables?.([image('second')])
    mockInputHandle?.addMentionable({
      type: 'url',
      url: 'https://example.com',
    })
    mockOnCreateImageMentionables?.([image('first')])

    expect(
      updates
        .at(-1)
        ?.filter(
          (mentionable): mentionable is MentionableImage =>
            mentionable.type === 'image',
        )
        .map((mentionable) => mentionable.name),
    ).toEqual(['second', 'first'])
    expect(updates.at(-1)).toContainEqual({
      type: 'url',
      url: 'https://example.com',
    })
  })

  it('renders vault file previews as inert text', () => {
    const payload = '![tracking pixel](https://attacker.invalid/pixel)'
    mockQueryData = payload

    const html = renderToStaticMarkup(
      <ChatUserInput
        initialSerializedEditorState={null}
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        onFocus={jest.fn()}
        mentionables={[
          {
            type: 'file',
            file: { path: 'untrusted.md' } as import('obsidian').TFile,
          } as Mentionable,
        ]}
        setMentionables={jest.fn()}
        addedBlockKey="file:untrusted.md"
      />,
    )

    expect(mockSyntaxHighlighter.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ children: payload, language: 'markdown' }),
    )
    expect(html).toContain('![tracking pixel]')
    expect(html).not.toContain('<img')
  })
})
