import { Notice } from 'obsidian'

import { redactSecrets } from './security/redact-secrets'

export const ASYNC_ACTION_ERROR_NOTICE = 'The action failed. Please try again.'

export function runAsyncAction(action: () => unknown): Promise<boolean> {
  try {
    return Promise.resolve(action()).then(
      () => true,
      (error) => {
        reportAsyncActionError(error)
        return false
      },
    )
  } catch (error) {
    reportAsyncActionError(error)
    return Promise.resolve(false)
  }
}

function reportAsyncActionError(error: unknown): void {
  new Notice(ASYNC_ACTION_ERROR_NOTICE)
  console.error('Async UI action failed', redactSecrets(error))
}
