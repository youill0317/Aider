import { Notice } from 'obsidian'

import { ASYNC_ACTION_ERROR_NOTICE, runAsyncAction } from './async-action'

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
}))

describe('runAsyncAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports rejected callbacks without exposing secrets', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(
      runAsyncAction(async () => {
        throw new Error('Authorization: Bearer secret-access-token')
      }),
    ).resolves.toBe(false)

    expect(Notice).toHaveBeenCalledWith(ASYNC_ACTION_ERROR_NOTICE)
    const loggedError = consoleError.mock.calls[0]?.[1]
    expect(loggedError).toBeInstanceOf(Error)
    expect((loggedError as Error).message).toContain('[REDACTED]')
    expect((loggedError as Error).message).not.toContain('secret-access-token')
  })

  it('reports synchronous callback failures', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      runAsyncAction(() => {
        throw new Error('save failed')
      }),
    ).resolves.toBe(false)

    expect(Notice).toHaveBeenCalledWith(ASYNC_ACTION_ERROR_NOTICE)
  })

  it('reports successful callbacks to controlled inputs', async () => {
    await expect(runAsyncAction(() => undefined)).resolves.toBe(true)
  })
})
