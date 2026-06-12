import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  McpClient,
  McpServerConfig,
  McpServerStatus,
  McpTool,
  McpToolCallResult,
} from '../../types/mcp.types'

import { McpManager } from './mcpManager'

type ConnectedTool = {
  readonly serverName: string
  readonly toolName: string
  readonly callResult?: McpToolCallResult
}

type CreateMcpManagerTestHarnessOptions = {
  readonly servers: McpServerConfig[]
  readonly connectedTools: readonly ConnectedTool[]
}

export function createMcpManagerTestHarness({
  servers,
  connectedTools,
}: CreateMcpManagerTestHarnessOptions): McpManager {
  const manager = new McpManager({
    settings: createSettings(servers),
    registerSettingsListener: () => () => undefined,
  })
  const mutableManager = manager as unknown as {
    servers: ReturnType<typeof createConnectedServer>[]
  }
  mutableManager.servers = servers.map((server) =>
    createConnectedServer(
      server,
      connectedTools.filter((tool) => tool.serverName === server.id),
    ),
  )
  return manager
}

function createSettings(servers: McpServerConfig[]): SmartComposerSettings {
  return {
    version: 16,
    providers: [],
    chatModels: [],
    embeddingModels: [],
    chatModelId: 'chat',
    applyModelId: 'apply',
    embeddingModelId: 'embedding',
    systemPrompt: '',
    ragOptions: {
      chunkSize: 1000,
      thresholdTokens: 8192,
      minSimilarity: 0,
      limit: 10,
      excludePatterns: [],
      includePatterns: [],
    },
    mcp: {
      servers,
    },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
  }
}

function createConnectedServer(
  serverConfig: McpServerConfig,
  connectedTools: readonly ConnectedTool[],
) {
  return {
    name: serverConfig.id,
    config: serverConfig,
    status: McpServerStatus.Connected,
    client: createClient(connectedTools),
    tools: connectedTools.map((tool) => createTool(tool.toolName)),
  }
}

function createClient(connectedTools: readonly ConnectedTool[]): McpClient {
  return {
    listTools: async () => ({
      tools: connectedTools.map((tool) => createTool(tool.toolName)),
    }),
    callTool: async ({ name }: { name: string }) => {
      const connectedTool = connectedTools.find(
        (tool) => tool.toolName === name,
      )
      return (
        connectedTool?.callResult ?? {
          isError: false,
          content: [
            {
              type: 'text',
              text: 'ok',
            },
          ],
        }
      )
    },
  } as McpClient
}

function createTool(name: string): McpTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }
}
