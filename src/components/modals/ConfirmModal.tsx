import { App } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { redactSecrets } from '../../utils/security/redact-secrets'
import { ReactModal } from '../common/ReactModal'

export type ConfirmModalOptions = {
  title: string
  message: string
  ctaText?: string
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

type ConfirmModalComponentProps = {
  message: string
  ctaText?: string
  onConfirm: () => Promise<boolean>
  onClose: () => void
}

function createConfirmModalController(
  onConfirm: () => void | Promise<void>,
  onCancel?: () => void,
) {
  let completed = false
  let dismissed = false
  let pending = false

  return {
    confirm: async () => {
      if (pending || completed || dismissed) return false
      pending = true
      try {
        await onConfirm()
        if (dismissed) return false
        completed = true
        return true
      } finally {
        pending = false
      }
    },
    dismiss: () => {
      if (completed || dismissed) return
      dismissed = true
      onCancel?.()
    },
    canDismiss: () => !pending,
  }
}

export class ConfirmModal extends ReactModal<ConfirmModalComponentProps> {
  private readonly dismiss: () => void
  private readonly canDismiss: () => boolean

  constructor(app: App, options: ConfirmModalOptions) {
    const controller = createConfirmModalController(
      options.onConfirm,
      options.onCancel,
    )
    super({
      app: app,
      Component: ConfirmModalComponent,
      props: {
        message: options.message,
        ctaText: options.ctaText,
        onConfirm: controller.confirm,
      },
      options: {
        title: options.title,
      },
    })
    this.dismiss = controller.dismiss
    this.canDismiss = controller.canDismiss
  }

  close() {
    if (this.canDismiss()) super.close()
  }

  onClose() {
    super.onClose()
    this.dismiss()
  }
}

function ConfirmModalComponent({
  message,
  ctaText,
  onConfirm,
  onClose,
}: ConfirmModalComponentProps) {
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isMountedRef = useRef(true)

  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  const handleConfirm = async () => {
    setIsPending(true)
    setErrorMessage(null)
    try {
      if (await onConfirm()) onClose()
    } catch (error) {
      if (!isMountedRef.current) return
      setErrorMessage(
        redactSecrets(
          error instanceof Error ? error.message : 'Unable to complete action',
        ),
      )
    } finally {
      if (isMountedRef.current) setIsPending(false)
    }
  }

  return (
    <div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
      {errorMessage && (
        <div role="alert" style={{ color: 'var(--text-error)' }}>
          {errorMessage}
        </div>
      )}
      <div className="modal-button-container">
        <button
          type="button"
          className="mod-warning"
          onClick={handleConfirm}
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? 'Working...' : (ctaText ?? 'Confirm')}
        </button>
        <button
          type="button"
          className="mod-cancel"
          onClick={onClose}
          disabled={isPending}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
