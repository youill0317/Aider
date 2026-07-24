jest.mock('../common/ReactModal', () => ({
  ReactModal: class {
    props: unknown
    constructor({ props }: { props: unknown }) {
      this.props = props
    }
    close() {
      this.onClose()
    }
    onClose() {}
  },
}))

import { ConfirmModal } from './ConfirmModal'

function createModal(
  onConfirm: () => void | Promise<void>,
  onCancel?: () => void,
) {
  const modal = new ConfirmModal(null as never, {
    title: 'Confirm',
    message: 'Continue?',
    onConfirm,
    onCancel,
  })
  const confirm = (
    modal as unknown as { props: { onConfirm: () => Promise<boolean> } }
  ).props.onConfirm
  return { modal, confirm }
}

describe('ConfirmModal', () => {
  it('does not cancel after a successful confirmation', async () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()
    const { modal, confirm } = createModal(onConfirm, onCancel)

    await expect(confirm()).resolves.toBe(true)
    modal.close()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps a failed confirmation dismissible and cancels exactly once', async () => {
    const onCancel = jest.fn()
    const { modal, confirm } = createModal(() => {
      throw new Error('failed')
    }, onCancel)

    await expect(confirm()).rejects.toThrow('failed')
    modal.close()
    modal.close()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate confirmation and dismissal while pending', async () => {
    let resolveConfirm = () => {}
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        }),
    )
    const { modal, confirm } = createModal(onConfirm)

    const firstConfirmation = confirm()
    await expect(confirm()).resolves.toBe(false)
    modal.close()
    expect(onConfirm).toHaveBeenCalledTimes(1)

    resolveConfirm()
    await expect(firstConfirmation).resolves.toBe(true)
  })

  it('resolves a cancelled embedding warning when the modal is dismissed', async () => {
    let dismiss = () => {}
    const warningResult = new Promise<boolean>((resolve) => {
      const { modal } = createModal(
        () => resolve(true),
        () => resolve(false),
      )
      dismiss = () => modal.close()
    })

    dismiss()
    dismiss()

    await expect(warningResult).resolves.toBe(false)
  })

  it('routes programmatic dismissal through onCancel exactly once', () => {
    const onCancel = jest.fn()
    const { modal } = createModal(jest.fn(), onCancel)

    modal.close()
    modal.close()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
