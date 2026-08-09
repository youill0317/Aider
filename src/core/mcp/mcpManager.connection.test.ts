import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { shellEnv } from 'shell-env'

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
  getDefaultEnvironment: jest.fn(),
  StdioClientTransport: jest.fn(),
}))
jest.mock('shell-env', () => ({
  shellEnv: jest.fn(),
}))

describe('McpManager connection lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDefaultEnvironment as jest.Mock).mockReturnValue({
      HOME: '/home/user',
      PATH: '/usr/bin',
      USER: 'user',
    })
    ;(shellEnv as jest.Mock).mockResolvedValue({ PATH: '/login/bin' })
  })

  it('passes only the safe environment, login PATH, and explicit variables', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }))
    ;(shellEnv as jest.Mock).mockResolvedValue({
      GITHUB_PAT: 'inherited-secret',
      PATH: '/login/bin',
      SENTRY_DSN: 'inherited-dsn',
    })
    const { manager } = createManager({
      command: 'node',
      env: { EXPLICIT_ENV: 'configured' },
    })

    await manager.initialize()

    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: 'node',
      stderr: 'ignore',
      env: {
        EXPLICIT_ENV: 'configured',
        HOME: '/home/user',
        PATH: '/login/bin',
        USER: 'user',
      },
    })
    manager.cleanup()
  })

  it('loads the safe default environment when settings update before initialize', async () => {
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }))
    const { manager, serverConfig } = createManager({ command: 'node' })
    const settings = smartComposerSettingsSchema.parse({
      mcp: { servers: [serverConfig] },
    })

    await manager.handleSettingsUpdate(settings)

    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: '/home/user',
          PATH: '/login/bin',
          USER: 'user',
        }),
      }),
    )
    manager.cleanup()
  })

  it('does not start an MCP process before the exact command is trusted', async () => {
    const settings = smartComposerSettingsSchema.parse({
      mcp: {
        servers: [
          {
            enabled: true,
            id: 'untrusted',
            parameters: { command: 'node', args: ['server.js'] },
            toolOptions: {},
          },
        ],
      },
    })
    const manager = new McpManager({
      registerSettingsListener: () => () => undefined,
      settings,
      isServerTrusted: async () => false,
    })
    Object.defineProperty(manager, 'disabled', { value: false })

    await manager.initialize()

    expect(manager.getServers()[0]?.status).toBe(
      McpServerStatus.ApprovalRequired,
    )
    expect(StdioClientTransport).not.toHaveBeenCalled()
    expect(Client).not.toHaveBeenCalled()
    manager.cleanup()
  })

  it('disconnects a trusted server when tool options change', async () => {
    let trusted = true
    const close = jest.fn().mockResolvedValue(undefined)
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }))
    const { manager, serverConfig } = createManager()
    const settings = smartComposerSettingsSchema.parse({
      mcp: {
        servers: [
          {
            ...serverConfig,
            toolOptions: { destructive: { allowAutoExecution: true } },
          },
        ],
      },
    })
    ;(
      manager as unknown as {
        isServerTrusted: (config: McpServerConfig) => Promise<boolean>
      }
    ).isServerTrusted = async () => trusted

    await manager.initialize()
    trusted = false
    await manager.handleSettingsUpdate(settings)

    expect(manager.getServers()[0]?.status).toBe(
      McpServerStatus.ApprovalRequired,
    )
    expect(close).toHaveBeenCalledTimes(1)
    await manager.cleanup()
  })

  it('evicts and closes a server before trust revocation returns', async () => {
    let finishClose: (() => void) | undefined
    const close = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        }),
    )
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
    }))
    const { manager } = createManager()
    await manager.initialize()

    let finished = false
    const revocation = manager.revokeServerTrust('github').then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(manager.getServers()[0]?.status).toBe(
      McpServerStatus.ApprovalRequired,
    )
    expect(finished).toBe(false)
    finishClose?.()
    await revocation
    expect(close).toHaveBeenCalledTimes(1)
    await manager.cleanup()
  })

  it('does not initialize MCP clients while tools are disabled', async () => {
    const settings = smartComposerSettingsSchema.parse({
      chatOptions: {
        includeCurrentFileContent: true,
        enableTools: false,
        maxAutoIterations: 1,
      },
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
      isServerTrusted: async () => true,
    })
    Object.defineProperty(manager, 'disabled', { value: false })

    await manager.initialize()

    expect(Client).not.toHaveBeenCalled()
    expect(StdioClientTransport).not.toHaveBeenCalled()
    expect(manager.getServers()).toMatchObject([
      { status: McpServerStatus.Disconnected },
    ])
    await manager.cleanup()
  })

  it('limits concurrent MCP process connections', async () => {
    const settings = smartComposerSettingsSchema.parse({
      mcp: {
        servers: Array.from({ length: 9 }, (_, index) => ({
          enabled: true,
          id: `server-${index}`,
          parameters: { command: 'node' },
          toolOptions: {},
        })),
      },
    })
    const manager = new McpManager({
      registerSettingsListener: () => () => undefined,
      settings,
      isServerTrusted: async () => true,
    })
    Object.defineProperty(manager, 'disabled', { value: false })
    let active = 0
    let maximumActive = 0
    const connectServer = jest.fn(async (config: McpServerConfig) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active -= 1
      return {
        name: config.id,
        config,
        status: McpServerStatus.Disconnected,
      } as McpServerState
    })
    ;(
      manager as unknown as {
        connectServer: typeof connectServer
      }
    ).connectServer = connectServer

    await manager.initialize()

    expect(connectServer).toHaveBeenCalledTimes(9)
    expect(maximumActive).toBe(4)
    manager.cleanup()
  })

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

  it('collects every page of an MCP tool catalog', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    const listTools = jest
      .fn()
      .mockResolvedValueOnce({
        tools: [{ name: 'first', inputSchema: { type: 'object' } }],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'second', inputSchema: { type: 'object' } }],
      })
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools,
    }))
    const { manager, serverConfig } = createManager()

    const state = await (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)

    expect(state).toMatchObject({
      status: McpServerStatus.Connected,
      tools: [{ name: 'first' }, { name: 'second' }],
    })
    expect(listTools).toHaveBeenNthCalledWith(1)
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' })
    await manager.cleanup()
  })

  it('rejects a repeated MCP tool cursor and closes its client', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    const listTools = jest
      .fn()
      .mockResolvedValueOnce({ tools: [], nextCursor: 'repeat' })
      .mockResolvedValueOnce({ tools: [], nextCursor: 'repeat' })
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools,
    }))
    const { manager, serverConfig } = createManager()

    const state = await (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)

    expect(state).toMatchObject({
      status: McpServerStatus.Error,
      error: expect.objectContaining({
        message: expect.stringContaining('repeated tool cursor'),
      }),
    })
    expect(close).toHaveBeenCalledTimes(1)
    await manager.cleanup()
  })

  it('bounds a stalled MCP connection and closes its client', async () => {
    jest.useFakeTimers()
    try {
      let markConnectStarted: (() => void) | undefined
      const connectStarted = new Promise<void>((resolve) => {
        markConnectStarted = resolve
      })
      const close = jest.fn().mockResolvedValue(undefined)
      ;(Client as unknown as jest.Mock).mockImplementation(() => ({
        close,
        connect: jest.fn(
          () =>
            new Promise<void>(() => {
              markConnectStarted?.()
            }),
        ),
        listTools: jest.fn(),
      }))
      const { manager, serverConfig } = createManager()
      const connection = (
        manager as unknown as {
          connectServer: (config: McpServerConfig) => Promise<McpServerState>
        }
      ).connectServer(serverConfig)
      await connectStarted

      await jest.advanceTimersByTimeAsync(20_000)

      await expect(connection).resolves.toMatchObject({
        status: McpServerStatus.Error,
        error: expect.objectContaining({
          message: expect.stringContaining('connection timed out'),
        }),
      })
      expect(close).toHaveBeenCalled()
      await manager.cleanup()
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds stalled MCP tool discovery and closes its client', async () => {
    jest.useFakeTimers()
    try {
      let markDiscoveryStarted: (() => void) | undefined
      const discoveryStarted = new Promise<void>((resolve) => {
        markDiscoveryStarted = resolve
      })
      const close = jest.fn().mockResolvedValue(undefined)
      ;(Client as unknown as jest.Mock).mockImplementation(() => ({
        close,
        connect: jest.fn().mockResolvedValue(undefined),
        listTools: jest.fn(
          () =>
            new Promise<void>(() => {
              markDiscoveryStarted?.()
            }),
        ),
      }))
      const { manager, serverConfig } = createManager()
      const connection = (
        manager as unknown as {
          connectServer: (config: McpServerConfig) => Promise<McpServerState>
        }
      ).connectServer(serverConfig)
      await discoveryStarted

      await jest.advanceTimersByTimeAsync(20_000)

      await expect(connection).resolves.toMatchObject({
        status: McpServerStatus.Error,
        error: expect.objectContaining({
          message: expect.stringContaining('tool discovery timed out'),
        }),
      })
      expect(close).toHaveBeenCalled()
      await manager.cleanup()
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects an oversized MCP tool catalog and closes its client', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    const createTools = (start: number, length: number) =>
      Array.from({ length }, (_, index) => ({
        name: `tool-${start + index}`,
        inputSchema: { type: 'object' },
      }))
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest
        .fn()
        .mockResolvedValueOnce({
          tools: createTools(0, 128),
          nextCursor: 'page-2',
        })
        .mockResolvedValueOnce({ tools: createTools(128, 129) }),
    }))
    const { manager, serverConfig } = createManager()

    const state = await (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)

    expect(state).toMatchObject({
      status: McpServerStatus.Error,
      error: expect.objectContaining({
        message: expect.stringContaining('more than 256 tools'),
      }),
    })
    expect(close).toHaveBeenCalled()
    await manager.cleanup()
  })

  it('rejects an oversized MCP tool schema and closes its client', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    ;(Client as unknown as jest.Mock).mockImplementation(() => ({
      close,
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({
        tools: [
          {
            name: 'huge-tool',
            description: 'x'.repeat(1024 * 1024),
            inputSchema: { type: 'object' },
          },
        ],
      }),
    }))
    const { manager, serverConfig } = createManager()

    const state = await (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)

    expect(state).toMatchObject({
      status: McpServerStatus.Error,
      error: expect.objectContaining({
        message: expect.stringContaining('catalog is too large'),
      }),
    })
    expect(close).toHaveBeenCalled()
    await manager.cleanup()
  })

  it('returns an error state when the default environment cannot be loaded', async () => {
    ;(shellEnv as jest.Mock).mockRejectedValueOnce(new Error('shell failed'))
    const { manager } = createManager()

    await expect(manager.initialize()).resolves.toBeUndefined()

    expect(manager.getServers()).toHaveLength(1)
    expect(manager.getServers()[0]).toMatchObject({
      status: McpServerStatus.Error,
      error: expect.objectContaining({
        message: expect.stringContaining('shell failed'),
      }),
    })
    manager.cleanup()
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

  it('waits for background client closures during cleanup', async () => {
    let finishClose: (() => void) | undefined
    const close = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        }),
    )
    const { manager, serverConfig } = createManager()
    const mutableManager = manager as unknown as {
      servers: McpServerState[]
      updateServers: (servers: McpServerState[]) => void
    }
    mutableManager.servers = [
      {
        name: serverConfig.id,
        config: serverConfig,
        status: McpServerStatus.Connected,
        client: { close } as unknown as McpClient,
        tools: [],
      },
    ]

    mutableManager.updateServers([])
    let cleanupFinished = false
    const cleanup = manager.cleanup().then(() => {
      cleanupFinished = true
    })
    await Promise.resolve()

    expect(close).toHaveBeenCalledTimes(1)
    expect(cleanupFinished).toBe(false)

    finishClose?.()
    await cleanup
    expect(cleanupFinished).toBe(true)
  })

  it('aborts active tool calls during cleanup', () => {
    const { manager } = createManager()
    const controller = new AbortController()
    const mutableManager = manager as unknown as {
      activeToolCalls: Map<string, AbortController>
    }
    mutableManager.activeToolCalls.set('call-1', controller)

    manager.cleanup()

    expect(controller.signal.aborted).toBe(true)
    expect(mutableManager.activeToolCalls.size).toBe(0)
  })

  it('closes a client that is still connecting during cleanup', async () => {
    const { close, started } = mockPendingClient()
    const { manager, serverConfig } = createManager()
    const connection = (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)
    await started

    manager.cleanup()

    await expect(connection).resolves.toMatchObject({
      status: McpServerStatus.Error,
    })
    expect(close).toHaveBeenCalled()
  })

  it('closes a pending client when settings supersede its revision', async () => {
    const { close, started } = mockPendingClient()
    const { manager, serverConfig } = createManager()
    const connection = (
      manager as unknown as {
        connectServer: (config: McpServerConfig) => Promise<McpServerState>
      }
    ).connectServer(serverConfig)
    await started

    await manager.handleSettingsUpdate(
      smartComposerSettingsSchema.parse({ mcp: { servers: [] } }),
    )

    await expect(connection).resolves.toMatchObject({
      status: McpServerStatus.Error,
    })
    expect(close).toHaveBeenCalled()
  })
})

function createManager(
  parameters: McpServerConfig['parameters'] = { command: 'node' },
) {
  const settings = smartComposerSettingsSchema.parse({
    mcp: {
      servers: [
        {
          enabled: true,
          id: 'github',
          parameters,
          toolOptions: {},
        },
      ],
    },
  })
  const manager = new McpManager({
    registerSettingsListener: () => () => undefined,
    settings,
    isServerTrusted: async () => true,
  })
  Object.defineProperty(manager, 'disabled', { value: false })
  return { manager, serverConfig: settings.mcp.servers[0] }
}

function mockPendingClient(): {
  close: jest.Mock
  started: Promise<void>
} {
  let rejectConnect: ((error: Error) => void) | undefined
  let markStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const close = jest.fn().mockImplementation(async () => {
    rejectConnect?.(new Error('connection closed'))
  })
  ;(Client as unknown as jest.Mock).mockImplementation(() => ({
    close,
    connect: jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectConnect = reject
          markStarted?.()
        }),
    ),
    listTools: jest.fn(),
  }))
  return { close, started }
}
