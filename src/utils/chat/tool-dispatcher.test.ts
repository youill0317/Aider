import type { ToolDispatcher } from './tool-dispatcher'
import {
  disabledToolDispatcher,
  resolveToolDispatcher,
} from './tool-dispatcher'

describe('resolveToolDispatcher', () => {
  it('does not initialize a dispatcher when tools are disabled', async () => {
    const getToolDispatcher = jest.fn<Promise<ToolDispatcher>, []>()

    await expect(resolveToolDispatcher(false, getToolDispatcher)).resolves.toBe(
      disabledToolDispatcher,
    )
    expect(getToolDispatcher).not.toHaveBeenCalled()
  })
})
