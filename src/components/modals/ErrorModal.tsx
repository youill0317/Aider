import { App } from 'obsidian'

import { redactSecrets } from '../../utils/security/redact-secrets'
import { ReactModal } from '../common/ReactModal'

type ErrorModalOptions = {
  showReportBugButton?: boolean
  showSettingsButton?: boolean
}

type ErrorModalComponentProps = {
  app: App
  message: string
  log?: string
  onClose: () => void
  options: ErrorModalOptions
}

export function getRedactedErrorModalProps({
  message,
  log,
}: {
  message: string
  log?: string
}): {
  message: string
  log?: string
} {
  return {
    message: redactSecrets(message),
    log: log === undefined ? undefined : redactSecrets(log),
  }
}

export class ErrorModal extends ReactModal<ErrorModalComponentProps> {
  constructor(
    app: App,
    title: string,
    message: string,
    log?: string,
    options: ErrorModalOptions = {},
  ) {
    const redactedProps = getRedactedErrorModalProps({ message, log })
    super({
      app: app,
      Component: ErrorModalComponent,
      props: {
        app,
        message: redactedProps.message,
        log: redactedProps.log,
        options,
      },
      options: {
        title,
      },
    })
  }
}

function ErrorModalComponent({
  app,
  message,
  log,
  onClose,
  options,
}: ErrorModalComponentProps) {
  return (
    <div className="smtcmp-error-modal-content">
      <div className="smtcmp-error-modal-message">{message}</div>
      {log && <pre className="smtcmp-error-modal-log">{log}</pre>}
      <div className="modal-button-container">
        {options.showReportBugButton && (
          <button
            className="mod-cta"
            onClick={() => {
              onClose()
              window.open(
                'https://github.com/glowingjade/obsidian-smart-composer/issues',
                '_blank',
              )
            }}
          >
            Report Bug
          </button>
        )}
        {options.showSettingsButton && (
          <button
            className="mod-cta"
            onClick={() => {
              onClose()
              // @ts-expect-error: setting property exists in Obsidian's App but is not typed
              app.setting.open()
              // @ts-expect-error: setting property exists in Obsidian's App but is not typed
              app.setting.openTabById('smart-composer')
            }}
          >
            Open Settings
          </button>
        )}
        <button className="mod-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
