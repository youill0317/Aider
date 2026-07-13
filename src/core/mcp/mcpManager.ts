import { Platform } from 'obsidian'

import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  McpClient,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpTool,
  McpToolCallResult,
} from '../../types/mcp.types'
import {
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

import { InvalidToolNameException, McpNotAvailableException } from './exception'
import {
  equalServerParameters,
  hasAdvertisedTool,
  redactMcpError,
} from './mcp-security'
import {
  DEFAULT_TOOL_NAME_DELIMITER,
  getToolName,
  parseToolName,
  validateServerName,
} from './tool-name-utils'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const MAX_MCP_TOOL_OUTPUT_CHARS = 24_000

export class McpManager {
  static readonly TOOL_NAME_DELIMITER = DEFAULT_TOOL_NAME_DELIMITER // Delimiter for tool name construction (serverName__toolName)

  public readonly disabled = !Platform.isDesktop // MCP should be disabled on mobile since it doesn't support node.js

  private settings: SmartComposerSettings
  private unsubscribeFromSettings: () => void
  private defaultEnv: Record<string, string> = {}
  private settingsRevision = 0

  private servers: McpServerState[] = [] // IMPORTANT: Always use this.updateServers() to update this array
  private activeToolCalls: Map<string, AbortController> = new Map()
  private allowedToolsByConversation: Map<string, Set<string>> = new Map()
  private subscribers = new Set<(servers: McpServerState[]) => void>()

  private availableToolsCache: McpTool[] | null = null

  constructor({
    settings,
    registerSettingsListener,
  }: {
    settings: SmartComposerSettings
    registerSettingsListener: (
      listener: (settings: SmartComposerSettings) => void,
    ) => () => void
  }) {
    this.settings = settings
    this.unsubscribeFromSettings = registerSettingsListener((newSettings) => {
      this.handleSettingsUpdate(newSettings)
    })
  }

  public async initialize() {
    if (this.disabled) {
      return
    }

    const revision = this.settingsRevision

    // Get default environment variables
    const { shellEnvSync } = await import('shell-env')
    this.defaultEnv = shellEnvSync()

    // Create MCP servers
    const servers = await Promise.all(
      this.settings.mcp.servers.map((serverConfig) =>
        this.connectServer(serverConfig),
      ),
    )
    if (revision !== this.settingsRevision) {
      await this.closeConnectedServers(servers)
      return
    }
    this.updateServers(servers)
  }

  public cleanup() {
    this.settingsRevision += 1
    void this.closeClients(
      this.servers
        .filter((s) => s.status === McpServerStatus.Connected)
        .map((s) => s.client),
    )

    if (this.unsubscribeFromSettings) {
      this.unsubscribeFromSettings()
    }

    this.servers = []
    this.subscribers.clear()
    this.activeToolCalls.clear()
  }

  public getServers() {
    return this.servers
  }

  public subscribeServersChange(callback: (servers: McpServerState[]) => void) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  public async handleSettingsUpdate(settings: SmartComposerSettings) {
    const revision = ++this.settingsRevision
    this.settings = settings
    const updatedServers = settings.mcp.servers.map(
      (serverConfig: McpServerConfig): McpServerState => {
        const existingServer = this.servers.find(
          (s) => s.name === serverConfig.id,
        )
        if (
          existingServer &&
          equalServerParameters(
            existingServer.config.parameters,
            serverConfig.parameters,
          ) &&
          existingServer.config.enabled === serverConfig.enabled
        ) {
          // Server is already up to date
          return {
            ...existingServer,
            config: serverConfig,
          }
        }
        return {
          name: serverConfig.id,
          config: serverConfig,
          status: McpServerStatus.Connecting,
        }
      },
    )

    this.updateServers(updatedServers)

    await Promise.all(
      updatedServers
        .filter((s) => s.status === McpServerStatus.Connecting)
        .map(async (s) => {
          const server = await this.connectServer(s.config)
          if (revision !== this.settingsRevision) {
            await this.closeConnectedServers([server])
            return
          }
          this.updateServers((prevServers) =>
            prevServers.map((prevServer) =>
              prevServer.name === server.name ? server : prevServer,
            ),
          )
        }),
    )
  }

  private async closeConnectedServers(servers: McpServerState[]) {
    await this.closeClients(
      servers
        .filter((server) => server.status === McpServerStatus.Connected)
        .map((server) => server.client),
    )
  }

  private async closeClients(clients: McpClient[]) {
    await Promise.allSettled(clients.map(async (client) => client.close()))
  }

  private notifySubscribers() {
    for (const cb of this.subscribers) cb(this.servers)
  }

  private updateServers(
    newServersOrUpdater?:
      | McpServerState[]
      | ((prevServers: McpServerState[]) => McpServerState[]),
  ) {
    const currentServers = this.servers
    const nextServers =
      typeof newServersOrUpdater === 'function'
        ? newServersOrUpdater(currentServers)
        : (newServersOrUpdater ?? currentServers)

    // Find clients that need to be disconnected
    const clientsToDisconnect = currentServers
      .filter((server) => server.status === McpServerStatus.Connected)
      .map((server) => server.client)
      .filter(
        (client) =>
          !nextServers.some(
            (server) =>
              server.status === McpServerStatus.Connected &&
              server.client === client,
          ),
      )

    // Disconnect clients in the background
    if (clientsToDisconnect.length > 0) {
      void this.closeClients(clientsToDisconnect)
    }

    this.servers = nextServers
    this.availableToolsCache = null // Invalidate available tools cache
    this.notifySubscribers() // Should call after invalidating the cache
  }

  private async connectServer(
    serverConfig: McpServerConfig,
  ): Promise<McpServerState> {
    if (this.disabled) {
      throw new McpNotAvailableException()
    }

    const { id: name, parameters: serverParams, enabled } = serverConfig

    if (!enabled) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Disconnected,
      }
    }

    try {
      validateServerName(name)
    } catch (error) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Error,
        error: error as Error,
      }
    }

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/stdio.js'
    )
    const client = new Client({ name, version: '1.0.0' })

    try {
      await client.connect(
        new StdioClientTransport({
          ...serverParams,
          env: {
            ...this.defaultEnv,
            ...(serverParams.env ?? {}),
          },
        }),
      )
    } catch (error) {
      await this.closeClients([client])
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Error,
        error: new Error(
          redactMcpError(
            `Failed to connect to MCP server ${name}: ${errorMessage(error)}`,
            serverConfig,
            this.defaultEnv,
          ),
        ),
      }
    }

    try {
      const toolList = await client.listTools()
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Connected,
        client,
        tools: toolList.tools,
      }
    } catch (error) {
      await this.closeClients([client])
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Error,
        error: new Error(
          redactMcpError(
            `Failed to list tools for MCP server ${name}: ${errorMessage(error)}`,
            serverConfig,
            this.defaultEnv,
          ),
        ),
      }
    }
  }

  public async listAvailableTools(): Promise<McpTool[]> {
    if (this.disabled || !this.settings.chatOptions.enableTools) {
      return []
    }

    if (this.availableToolsCache) {
      return this.availableToolsCache
    }

    const revision = this.settingsRevision
    const availableTools = (
      await Promise.all(
        this.servers.map(async (server): Promise<McpTool[]> => {
          if (server.status !== McpServerStatus.Connected) {
            return []
          }
          try {
            const toolList = await server.client.listTools()
            return toolList.tools
              .filter((tool) => !server.config.toolOptions[tool.name]?.disabled)
              .map((tool) => ({
                ...tool,
                name: getToolName(server.name, tool.name),
              }))
          } catch (error) {
            console.error(
              redactMcpError(
                `Failed to list tools for MCP server ${server.name}: ${errorMessage(error)}`,
                server.config,
                this.defaultEnv,
              ),
            )
            return []
          }
        }),
      )
    ).flat()

    if (
      revision !== this.settingsRevision ||
      !this.settings.chatOptions.enableTools
    ) {
      return []
    }

    this.availableToolsCache = [...availableTools]
    return availableTools
  }

  public allowToolForConversation(
    requestToolName: string,
    conversationId: string,
  ): void {
    if (this.disabled || !this.settings.chatOptions.enableTools) {
      return
    }
    let allowedTools = this.allowedToolsByConversation.get(conversationId)
    if (!allowedTools) {
      allowedTools = new Set<string>()
      this.allowedToolsByConversation.set(conversationId, allowedTools)
    }
    allowedTools.add(requestToolName)
  }

  public isToolExecutionAllowed({
    requestToolName,
    conversationId,
  }: {
    requestToolName: string
    conversationId?: string
  }): boolean {
    if (this.disabled || !this.settings.chatOptions.enableTools) {
      return false
    }

    try {
      const { serverName, toolName } = parseToolName(requestToolName)
      const server = this.servers.find((server) => server.name === serverName)
      if (!server || server.status !== McpServerStatus.Connected) {
        return false
      }
      const toolOption = server.config.toolOptions[toolName]
      if (toolOption?.disabled) {
        return false
      }
      if (!hasAdvertisedTool(server, toolName)) {
        return false
      }
      if (
        conversationId &&
        this.allowedToolsByConversation
          .get(conversationId)
          ?.has(requestToolName)
      ) {
        return true
      }
      return toolOption?.allowAutoExecution ?? false
    } catch (error) {
      if (error instanceof InvalidToolNameException) {
        return false
      }
      throw error
    }
  }

  public async callTool({
    name,
    args,
    id,
    signal,
  }: {
    name: string
    args?: Record<string, unknown> | string | undefined
    id?: string
    signal?: AbortSignal
  }): Promise<
    Extract<
      ToolCallResponse,
      {
        status:
          | ToolCallResponseStatus.Success
          | ToolCallResponseStatus.Error
          | ToolCallResponseStatus.Aborted
      }
    >
  > {
    if (this.disabled) {
      throw new McpNotAvailableException()
    }

    let serverConfigForRedaction: McpServerConfig | undefined = undefined
    const toolAbortController = new AbortController()
    if (id !== undefined) {
      const existingAbortController = this.activeToolCalls.get(id)
      if (existingAbortController) {
        existingAbortController.abort()
      }
      this.activeToolCalls.set(id, toolAbortController)
    }
    const compositeSignal = toolAbortController.signal
    if (signal) {
      signal.addEventListener('abort', () => toolAbortController.abort())
    }

    try {
      if (!this.settings.chatOptions.enableTools) {
        throw new Error('MCP tools are disabled')
      }
      const { serverName, toolName } = parseToolName(name)
      const server = this.servers.find((server) => server.name === serverName)
      if (!server) {
        throw new Error(`MCP server ${serverName} not found`)
      }
      if (server.status !== McpServerStatus.Connected) {
        throw new Error(`MCP server ${serverName} is not connected`)
      }
      serverConfigForRedaction = server.config
      const toolOption = server.config.toolOptions[toolName]
      if (toolOption?.disabled) {
        throw new Error(`MCP tool ${serverName}:${toolName} is disabled`)
      }
      if (!hasAdvertisedTool(server, toolName)) {
        throw new Error(`MCP tool ${serverName}:${toolName} is not available`)
      }
      const { client } = server

      const parsedArgs: Record<string, unknown> | undefined =
        typeof args === 'string' ? (args === '' ? {} : JSON.parse(args)) : args

      const result = (await client.callTool(
        {
          name: toolName,
          arguments: parsedArgs,
        },
        undefined,
        {
          signal: compositeSignal,
        },
      )) as McpToolCallResult

      if (result.content.length === 0) {
        throw new Error('Tool call returned no content')
      }
      if (result.content[0].type !== 'text') {
        throw new Error(
          `Tool result with content type ${result.content[0].type} is not currently supported.`,
        )
      }
      if (result.isError) {
        return {
          status: ToolCallResponseStatus.Error,
          error: this.boundAndRedactToolOutput(
            result.content[0].text,
            serverConfigForRedaction,
          ),
        }
      }
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text: this.boundAndRedactToolOutput(
            result.content[0].text,
            serverConfigForRedaction,
          ),
        },
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return {
          status: ToolCallResponseStatus.Aborted,
        }
      }

      // Handle other errors
      return {
        status: ToolCallResponseStatus.Error,
        error: this.boundAndRedactToolOutput(
          error instanceof Error ? error.message : 'Unknown error occurred',
          serverConfigForRedaction,
        ),
      }
    } finally {
      if (id !== undefined) {
        this.activeToolCalls.delete(id)
      }
    }
  }

  private boundAndRedactToolOutput(
    value: string,
    serverConfig?: McpServerConfig,
  ): string {
    return redactMcpError(value, serverConfig, this.defaultEnv).slice(
      0,
      MAX_MCP_TOOL_OUTPUT_CHARS,
    )
  }

  public abortToolCall(id: string): boolean {
    if (this.disabled) {
      return false
    }
    const toolAbortController = this.activeToolCalls.get(id)
    if (toolAbortController) {
      toolAbortController.abort()
      this.activeToolCalls.delete(id)
      return true
    }
    return false
  }
}
