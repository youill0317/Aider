let mockCommandHandler: ((payload: never) => boolean) | undefined
let mockCleanup: (() => void) | undefined
const mockUnregister = jest.fn()
const mockConvertFilesToMentionableImages = jest.fn()

jest.mock('react', () => ({
  useEffect: (effect: () => undefined | (() => undefined)) => {
    mockCleanup = effect() ?? undefined
  },
  useRef: (value: unknown) => ({ current: value }),
}))

jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [
    {
      registerCommand: (
        _command: unknown,
        handler: (payload: never) => boolean,
      ) => {
        mockCommandHandler = handler
        return mockUnregister
      },
    },
  ],
}))

jest.mock('lexical', () => ({
  COMMAND_PRIORITY_HIGH: 3,
  COMMAND_PRIORITY_LOW: 1,
  PASTE_COMMAND: 'paste',
}))

jest.mock('@lexical/rich-text', () => ({
  DRAG_DROP_PASTE: 'drag-drop-paste',
}))

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
}))

jest.mock('../../../../../utils/llm/image', () => ({
  convertFilesToMentionableImages: mockConvertFilesToMentionableImages,
}))

import DragDropPaste from './DragDropPastePlugin'
import ImagePastePlugin from './ImagePastePlugin'

class TestClipboardEvent {
  constructor(readonly clipboardData: { files: File[] }) {}
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('image plugin async lifecycle', () => {
  const NativeClipboardEvent = globalThis.ClipboardEvent

  beforeAll(() => {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
      configurable: true,
      value: TestClipboardEvent,
    })
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'ClipboardEvent', {
      configurable: true,
      value: NativeClipboardEvent,
    })
  })

  beforeEach(() => {
    mockCommandHandler = undefined
    mockCleanup = undefined
    mockUnregister.mockClear()
    mockConvertFilesToMentionableImages.mockReset()
  })

  it.each([
    [
      'paste',
      (onCreate: jest.Mock) =>
        ImagePastePlugin({ onCreateImageMentionables: onCreate }),
      () =>
        new TestClipboardEvent({
          files: [{ type: 'image/png' } as File],
        }) as never,
    ],
    [
      'drag/drop',
      (onCreate: jest.Mock) =>
        DragDropPaste({ onCreateImageMentionables: onCreate }),
      () => [{ type: 'image/png' } as File] as never,
    ],
  ])(
    'ignores a late %s conversion after unmount',
    async (_name, renderPlugin, payload) => {
      const conversion = deferred<{ images: never[]; rejected: never[] }>()
      mockConvertFilesToMentionableImages.mockReturnValue(conversion.promise)
      const onCreate = jest.fn()
      renderPlugin(onCreate)

      expect(mockCommandHandler?.(payload())).toBe(true)
      mockCleanup?.()
      conversion.resolve({ images: [], rejected: [] })
      await conversion.promise
      await Promise.resolve()

      expect(mockUnregister).toHaveBeenCalledTimes(1)
      expect(onCreate).not.toHaveBeenCalled()
    },
  )
})
