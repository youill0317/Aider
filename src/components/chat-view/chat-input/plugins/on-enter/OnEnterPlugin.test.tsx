import { createOnEnterHandler } from './OnEnterPlugin'

describe('OnEnterPlugin', () => {
  it.each([
    ['Ctrl+Enter', false, true, false],
    ['Cmd+Enter', true, false, true],
  ])(
    'uses %s for normal chat submission',
    (_name, isMacOS, ctrlKey, metaKey) => {
      const onEnter = jest.fn()
      const onVaultChat = jest.fn()
      const handler = createOnEnterHandler(onEnter, onVaultChat, false, isMacOS)
      const event = {
        ctrlKey,
        isComposing: false,
        metaKey,
        preventDefault: jest.fn(),
        shiftKey: false,
        stopPropagation: jest.fn(),
      } as unknown as KeyboardEvent

      expect(handler(event)).toBe(true)
      expect(onEnter).toHaveBeenCalledWith(event)
      expect(onVaultChat).not.toHaveBeenCalled()
    },
  )

  it('allows an unmodified mobile Enter to insert a newline', () => {
    const onEnter = jest.fn()
    const preventDefault = jest.fn()
    const stopPropagation = jest.fn()
    const event = {
      ctrlKey: false,
      isComposing: false,
      metaKey: false,
      preventDefault,
      shiftKey: false,
      stopPropagation,
    } as unknown as KeyboardEvent

    expect(createOnEnterHandler(onEnter, undefined, true, false)(event)).toBe(
      false,
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(onEnter).not.toHaveBeenCalled()
  })
})
