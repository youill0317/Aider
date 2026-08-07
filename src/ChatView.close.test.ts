import { Notice } from 'obsidian'

import { ChatView } from './ChatView'

jest.mock('./components/chat-view/Chat', () => ({
  __esModule: true,
  default: {},
}))
jest.mock('react-dom/client', () => ({ createRoot: jest.fn() }))

type ChatRefStub = {
  abortActiveWork: () => Promise<void>
  flushPendingSave: () => Promise<void>
}

/**
 * Builds a ChatView with only the fields onClose touches, and records the
 * order in which it drives them.
 */
function createChatView({
  onAbort,
  onFlush,
}: {
  onAbort?: () => Promise<void>
  onFlush?: () => Promise<void>
} = {}) {
  const steps: string[] = []
  const current: ChatRefStub = {
    abortActiveWork: async () => {
      steps.push('abort')
      if (onAbort) await onAbort()
    },
    flushPendingSave: async () => {
      steps.push('flush')
      if (onFlush) await onFlush()
    },
  }
  const root = {
    unmount: jest.fn(() => steps.push('unmount')),
  }

  const chatView = Object.assign(Object.create(ChatView.prototype), {
    chatRef: { current },
    root,
  }) as ChatView

  return { chatView, root, steps }
}

const readRoot = (chatView: ChatView) =>
  (chatView as unknown as { root: unknown }).root

describe('ChatView.onClose', () => {
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  beforeEach(() => {
    ;(Notice as unknown as jest.Mock).mockClear()
    consoleError.mockClear()
  })

  it('aborts in-flight work before flushing the pending save, then unmounts', async () => {
    const { chatView, steps } = createChatView()

    await chatView.onClose()

    // Flushing first would persist a transcript the aborted turn is still
    // writing to.
    expect(steps).toEqual(['abort', 'flush', 'unmount'])
    expect(Notice).not.toHaveBeenCalled()
  })

  it('still flushes the pending save when the abort fails', async () => {
    const { chatView, steps } = createChatView({
      onAbort: () => Promise.reject(new Error('abort failed')),
    })

    await chatView.onClose()

    expect(steps).toEqual(['abort', 'flush', 'unmount'])
    expect(Notice).toHaveBeenCalledTimes(1)
  })

  it('unmounts even when both close steps fail', async () => {
    const { chatView, root, steps } = createChatView({
      onAbort: () => Promise.reject(new Error('abort failed')),
      onFlush: () => Promise.reject(new Error('save failed')),
    })

    await chatView.onClose()

    expect(steps).toEqual(['abort', 'flush', 'unmount'])
    expect(root.unmount).toHaveBeenCalledTimes(1)
    expect(Notice).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('redacts secrets out of the logged close failure', async () => {
    const { chatView } = createChatView({
      onFlush: () =>
        Promise.reject(new Error('save failed: api_key=SUPERSECRETKEY')),
    })

    await chatView.onClose()

    const [, logged] = consoleError.mock.calls[0] as [string, Error[]]
    expect(logged[0].message).toBe('save failed: api_key=[REDACTED]')
  })

  it('drops the root so a second close cannot unmount twice', async () => {
    const { chatView, root } = createChatView()

    await chatView.onClose()
    await chatView.onClose()

    expect(root.unmount).toHaveBeenCalledTimes(1)
    expect(readRoot(chatView)).toBeNull()
  })
})
