import { App } from 'obsidian'

import { ReactModal } from '../common/ReactModal'

export class InstallerUpdateRequiredModal extends ReactModal<
  Record<string, never>
> {
  constructor(app: App) {
    super({
      app: app,
      Component: InstallerUpdateRequiredModalComponent,
      props: {},
      options: {
        title: 'Aider requires an Obsidian update',
      },
    })
  }
}

function InstallerUpdateRequiredModalComponent() {
  return (
    <div>
      <div>
        Aider requires a newer version of the Obsidian installer. Please note
        that this is different from Obsidian&apos;s in-app updates. You must
        manually download the latest version of Obsidian to continue using
        Aider.
      </div>
      <div>
        <div className="modal-button-container">
          <button
            className="mod-cta"
            onClick={() => {
              window.open(
                'https://obsidian.md/download',
                '_blank',
                'noopener,noreferrer',
              )
            }}
          >
            Open Download Page
          </button>
        </div>
      </div>
    </div>
  )
}
