import { ToolCallResponseStatus } from '../../types/tool-call.types'

import type { ToolDispatcher } from './tool-dispatcher'
import {
  createToolDispatcher,
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

it('passes Codex permission requests through unchanged', async () => {
  const onPermissionRequest = jest.fn()
  const callTool = jest.fn().mockResolvedValue({
    status: ToolCallResponseStatus.Success,
    data: { type: 'text', text: 'done' },
  })
  const dispatcher = createToolDispatcher({
    codexToolRunner: {
      callTool,
      isAvailable: () => true,
    } as never,
  })

  await dispatcher.callTool({
    id: 'call-1',
    name: 'run_codex',
    onPermissionRequest,
  })

  expect(callTool).toHaveBeenCalledWith(
    expect.objectContaining({ onPermissionRequest }),
  )
})
