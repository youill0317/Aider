let mockCommandHandler: ((event: KeyboardEvent) => boolean) | undefined
let mockIsMacOS = false

jest.mock('react', () => ({
  useEffect: (effect: () => void) => effect(),
}))

jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [
    {
      registerCommand: (
        _command: unknown,
        handler: (event: KeyboardEvent) => boolean,
      ) => {
        mockCommandHandler = handler
        return jest.fn()
      },
    },
  ],
}))

jest.mock('lexical', () => ({
  COMMAND_PRIORITY_LOW: 1,
  KEY_ENTER_COMMAND: 'enter',
}))

jest.mock('obsidian', () => ({
  Platform: {
    get isMacOS() {
      return mockIsMacOS
    },
  },
}))

import OnEnterPlugin from './OnEnterPlugin'

describe('OnEnterPlugin', () => {
  it.each([
    ['Ctrl+Enter', false, true, false],
    ['Cmd+Enter', true, false, true],
  ])(
    'uses %s for normal chat submission',
    (_name, isMacOS, ctrlKey, metaKey) => {
      mockIsMacOS = isMacOS
      const onEnter = jest.fn()
      const onVaultChat = jest.fn()
      OnEnterPlugin({ onEnter, onVaultChat })
      const event = {
        ctrlKey,
        isComposing: false,
        metaKey,
        preventDefault: jest.fn(),
        shiftKey: false,
        stopPropagation: jest.fn(),
      } as unknown as KeyboardEvent

      expect(mockCommandHandler?.(event)).toBe(true)
      expect(onEnter).toHaveBeenCalledWith(event)
      expect(onVaultChat).not.toHaveBeenCalled()
    },
  )
})
