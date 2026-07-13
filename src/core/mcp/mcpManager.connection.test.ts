import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import {
  McpClient,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
} from '../../types/mcp.types'

import { McpManager } from './mcpManager'

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn(),
}))
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn(),
}))

describe('McpManager connection lifecycle', () => {
  it('closes a connected client when initial tool discovery fails', async () => {
    const close = jest.fn().mockRejectedValue(new Error('close failed'))
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockRejectedValue(new Error('list failed')),
    }))
    const { manager, serverConfig } = createManager()

    const state = await (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)

    expect(state.status).toBe(McpServerStatus.Error)
    expect(
      state.status === McpServerStatus.Error ? state.error.message : '',
    ).toContain('list failed')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes every client even when one close fails', async () => {
    const first = { close: jest.fn().mockRejectedValue(new Error('failed')) }
    const second = { close: jest.fn().mockResolvedValue(undefined) }
    const { manager } = createManager()

    await expect(
      (
        manager as unknown as {
          closeClients: (clients: McpClient[]) => Promise<void>
        }
      ).closeClients([
        first as unknown as McpClient,
        second as unknown as McpClient,
      ]),
    ).resolves.toBeUndefined()

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).toHaveBeenCalledTimes(1)
  })
})

function createManager() {
  const settings = smartComposerSettingsSchema.parse({
    mcp: {
      servers: [
        {
          enabled: true,
          id: 'github',
          parameters: { command: 'node' },
          toolOptions: {},
        },
      ],
    },
  })
  const manager = new McpManager({
    registerSettingsListener: () => () => undefined,
    settings,
  })
  Object.defineProperty(manager, 'disabled', { value: false })
  return { manager, serverConfig: settings.mcp.servers[0] }
}
