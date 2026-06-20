import type { ViewCreator } from 'obsidian'

import {
  APPLY_VIEW_TYPE,
  CHAT_VIEW_TYPE,
  LEGACY_APPLY_VIEW_TYPE,
  LEGACY_CHAT_VIEW_TYPE,
} from './constants'

export type AiderMigrationWiringHost = {
  readonly adoptSmartComposerData: () => Promise<void>
  readonly loadSettings: () => Promise<void>
  readonly registerView: (type: string, viewCreator: ViewCreator) => void
}

export type AiderMigrationViewCreators = {
  readonly applyView: ViewCreator
  readonly chatView: ViewCreator
}

function registerOptionalViewAlias(
  host: AiderMigrationWiringHost,
  type: string,
  viewCreator: ViewCreator,
): void {
  try {
    host.registerView(type, viewCreator)
  } catch (error) {
    if (error instanceof Error) {
      console.warn(
        `Aider skipped optional legacy Smart Composer view alias "${type}" because Obsidian rejected that registration.`,
        error,
      )
      return
    }

    throw error
  }
}

export async function loadAiderMigrationWiring(
  host: AiderMigrationWiringHost,
  viewCreators: AiderMigrationViewCreators,
): Promise<void> {
  await host.adoptSmartComposerData()
  await host.loadSettings()

  host.registerView(CHAT_VIEW_TYPE, viewCreators.chatView)
  host.registerView(APPLY_VIEW_TYPE, viewCreators.applyView)
  registerOptionalViewAlias(host, LEGACY_CHAT_VIEW_TYPE, viewCreators.chatView)
  registerOptionalViewAlias(
    host,
    LEGACY_APPLY_VIEW_TYPE,
    viewCreators.applyView,
  )
}
