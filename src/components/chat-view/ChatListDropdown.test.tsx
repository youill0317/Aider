jest.mock('obsidian', () => ({ Notice: jest.fn() }))

import { createTitleInputController } from './ChatListDropdown'

describe('createTitleInputController', () => {
  it('submits once after success', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const controller = createTitleInputController(
      'Original',
      onSubmit,
      jest.fn(),
    )

    await expect(controller.submit('First edit')).resolves.toBe(true)
    await expect(controller.submit('Second edit')).resolves.toBe(false)

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit after cancellation', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const onCancel = jest.fn()
    const controller = createTitleInputController(
      'Original',
      onSubmit,
      onCancel,
    )

    expect(controller.cancel()).toBe(true)
    expect(controller.cancel()).toBe(false)
    await expect(controller.submit('Edited')).resolves.toBe(false)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('allows retry after a failed submit', async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined)
    const controller = createTitleInputController(
      'Original',
      onSubmit,
      jest.fn(),
    )

    await expect(controller.submit('First edit')).rejects.toThrow('failed')
    await expect(controller.submit('Second edit')).resolves.toBe(true)

    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('submits the current value instead of the initial title', async () => {
    const initialTitle = 'Original'
    const currentValue = 'User-edited title'
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const controller = createTitleInputController(
      initialTitle,
      onSubmit,
      jest.fn(),
    )

    await controller.submit(currentValue)

    expect(onSubmit).toHaveBeenCalledWith(currentValue)
    expect(onSubmit).not.toHaveBeenCalledWith(initialTitle)
  })
})
