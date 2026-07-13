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
import { chunkArray } from '../../utils/common/chunk-array'

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
const MAX_MCP_RAW_TOOL_OUTPUT_CHARS = 256_000
const MAX_MCP_TOOL_ARGUMENT_CHARS = 1024 * 1024
const MCP_CONNECTION_CONCURRENCY = 4
const MAX_CONVERSATION_TOOL_ALLOWLISTS = 1_000

export class McpManager {
  static readonly TOOL_NAME_DELIMITER = DEFAULT_TOOL_NAME_DELIMITER // Delimiter for tool name construction (serverName__toolName)

  public readonly disabled = !Platform.isDesktop // MCP should be disabled on mobile since it doesn't support node.js

  private settings: SmartComposerSettings
  private readonly isServerTrusted: (
    config: McpServerConfig,
  ) => Promise<boolean>
  private unsubscribeFromSettings: () => void
  private defaultEnv: Record<string, string> = {}
  private defaultEnvPromise: Promise<void> | null = null
  private settingsRevision = 0
  private disposed = false

  private servers: McpServerState[] = [] // IMPORTANT: Always use this.updateServers() to update this array
  private pendingClients = new Set<McpClient>()
  private activeToolCalls: Map<string, AbortController> = new Map()
  private allowedToolsByConversation: Map<string, Set<string>> = new Map()
  private subscribers = new Set<(servers: McpServerState[]) => void>()

  private availableToolsCache: McpTool[] | null = null

  constructor({
    settings,
    registerSettingsListener,
    isServerTrusted,
  }: {
    settings: SmartComposerSettings
    registerSettingsListener: (
      listener: (settings: SmartComposerSettings) => void,
    ) => () => void
    isServerTrusted: (config: McpServerConfig) => Promise<boolean>
  }) {
    this.settings = settings
    this.isServerTrusted = isServerTrusted
    this.unsubscribeFromSettings = registerSettingsListener((newSettings) => {
      void this.handleSettingsUpdate(newSettings).catch(() => {
        console.error('Failed to update MCP server settings')
      })
    })
  }

  public async initialize() {
    if (this.disabled || this.disposed) {
      return
    }

    const revision = this.settingsRevision

    // Create MCP servers
    const servers = await this.connectServers(
      this.settings.mcp.servers,
      revision,
    )
    if (!this.isConnectionCurrent(revision)) {
      await this.closeConnectedServers(servers)
      return
    }
    this.releaseConnectedClients(servers)
    this.updateServers(servers)
  }

  public cleanup() {
    this.disposed = true
    this.settingsRevision += 1
    for (const controller of this.activeToolCalls.values()) {
      controller.abort()
    }
    const clients = new Set([
      ...this.pendingClients,
      ...this.servers
        .filter((s) => s.status === McpServerStatus.Connected)
        .map((s) => s.client),
    ])
    void this.closeClients([...clients])

    if (this.unsubscribeFromSettings) {
      this.unsubscribeFromSettings()
    }

    this.servers = []
    this.availableToolsCache = null
    this.subscribers.clear()
    this.activeToolCalls.clear()
    this.allowedToolsByConversation.clear()
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
    await this.closeClients([...this.pendingClients])
    if (this.disabled || !this.isConnectionCurrent(revision)) return

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
          existingServer.config.enabled === serverConfig.enabled &&
          (existingServer.status === McpServerStatus.Connected ||
            (existingServer.status === McpServerStatus.Disconnected &&
              !serverConfig.enabled))
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

    const connectingServers = updatedServers.filter(
      (server) => server.status === McpServerStatus.Connecting,
    )
    if (connectingServers.length === 0) return

    for (const batch of chunkArray(
      connectingServers,
      MCP_CONNECTION_CONCURRENCY,
    )) {
      await Promise.all(
        batch.map(async (s) => {
          const server = await this.connectServer(s.config, revision)
          if (!this.isConnectionCurrent(revision)) {
            await this.closeConnectedServers([server])
            return
          }
          this.releaseConnectedClients([server])
          this.updateServers((prevServers) =>
            prevServers.map((prevServer) =>
              prevServer.name === server.name ? server : prevServer,
            ),
          )
        }),
      )
    }
  }

  private async connectServers(
    configs: McpServerConfig[],
    revision: number,
  ): Promise<McpServerState[]> {
    const servers: McpServerState[] = []
    for (const batch of chunkArray(configs, MCP_CONNECTION_CONCURRENCY)) {
      servers.push(
        ...(await Promise.all(
          batch.map((config) => this.connectServer(config, revision)),
        )),
      )
    }
    return servers
  }

  private async closeConnectedServers(servers: McpServerState[]) {
    await this.closeClients(
      servers
        .filter((server) => server.status === McpServerStatus.Connected)
        .map((server) => server.client),
    )
  }

  private async closeClients(clients: McpClient[]) {
    const uniqueClients = [...new Set(clients)]
    uniqueClients.forEach((client) => this.pendingClients.delete(client))
    await Promise.allSettled(uniqueClients.map((client) => client.close()))
  }

  private releaseConnectedClients(servers: McpServerState[]) {
    for (const server of servers) {
      if (server.status === McpServerStatus.Connected) {
        this.pendingClients.delete(server.client)
      }
    }
  }

  private isConnectionCurrent(revision: number): boolean {
    return !this.disposed && revision === this.settingsRevision
  }

  private ensureDefaultEnvironment(): Promise<void> {
    if (!this.defaultEnvPromise) {
      this.defaultEnvPromise = Promise.all([
        import('shell-env'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ])
        .then(async ([{ shellEnv }, { getDefaultEnvironment }]) => {
          const loginShellPath = (await shellEnv()).PATH
          this.defaultEnv = {
            ...getDefaultEnvironment(),
            ...(loginShellPath ? { PATH: loginShellPath } : {}),
          }
        })
        .catch((error: unknown) => {
          this.defaultEnvPromise = null
          throw error
        })
    }
    return this.defaultEnvPromise
  }

  private notifySubscribers() {
    for (const callback of this.subscribers) {
      try {
        callback(this.servers)
      } catch {
        console.error('MCP server subscriber failed')
      }
    }
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
    revision = this.settingsRevision,
  ): Promise<McpServerState> {
    if (this.disabled) {
      throw new McpNotAvailableException()
    }

    const { id: name, parameters: serverParams, enabled } = serverConfig

    if (!enabled || !this.isConnectionCurrent(revision)) {
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

    let trusted = false
    try {
      trusted = await this.isServerTrusted(serverConfig)
    } catch {
      trusted = false
    }
    if (!this.isConnectionCurrent(revision)) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Disconnected,
      }
    }
    if (!trusted) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.ApprovalRequired,
      }
    }

    let Client: typeof import('@modelcontextprotocol/sdk/client/index.js').Client
    let StdioClientTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport
    try {
      await this.ensureDefaultEnvironment()
      ;[{ Client }, { StdioClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ])
    } catch (error) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Error,
        error: new Error(
          redactMcpError(
            `Failed to initialize MCP server ${name}: ${errorMessage(error)}`,
            serverConfig,
            this.defaultEnv,
          ),
        ),
      }
    }
    if (!this.isConnectionCurrent(revision)) {
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Disconnected,
      }
    }
    const client = new Client({ name, version: '1.0.0' })
    this.pendingClients.add(client)

    try {
      await client.connect(
        new StdioClientTransport({
          ...serverParams,
          stderr: 'ignore',
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

    if (!this.isConnectionCurrent(revision)) {
      await this.closeClients([client])
      return {
        name,
        config: serverConfig,
        status: McpServerStatus.Disconnected,
      }
    }

    try {
      const toolList = await client.listTools()
      if (!this.isConnectionCurrent(revision)) {
        await this.closeClients([client])
        return {
          name,
          config: serverConfig,
          status: McpServerStatus.Disconnected,
        }
      }
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
    if (
      this.disabled ||
      this.disposed ||
      !this.settings.chatOptions.enableTools
    ) {
      return []
    }

    if (this.availableToolsCache) {
      return this.availableToolsCache
    }

    const revision = this.settingsRevision
    const availableTools = this.servers.flatMap((server): McpTool[] => {
      if (server.status !== McpServerStatus.Connected) {
        return []
      }
      return server.tools
        .filter((tool) => !server.config.toolOptions[tool.name]?.disabled)
        .map((tool) => ({
          ...tool,
          name: getToolName(server.name, tool.name),
        }))
    })

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
    try {
      const { serverName, toolName } = parseToolName(requestToolName)
      const server = this.servers.find(({ name }) => name === serverName)
      if (
        !server ||
        server.status !== McpServerStatus.Connected ||
        server.config.toolOptions[toolName]?.disabled ||
        !hasAdvertisedTool(server, toolName)
      ) {
        return
      }
    } catch (error) {
      if (error instanceof InvalidToolNameException) return
      throw error
    }
    let allowedTools = this.allowedToolsByConversation.get(conversationId)
    if (!allowedTools) {
      if (
        this.allowedToolsByConversation.size >= MAX_CONVERSATION_TOOL_ALLOWLISTS
      ) {
        const oldestConversation = this.allowedToolsByConversation.keys().next()
        if (!oldestConversation.done) {
          this.allowedToolsByConversation.delete(oldestConversation.value)
        }
      }
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
    const abortFromCaller = () => toolAbortController.abort()
    if (signal?.aborted) {
      abortFromCaller()
    } else {
      signal?.addEventListener('abort', abortFromCaller, { once: true })
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

      if (
        typeof args === 'string' &&
        args.length > MAX_MCP_TOOL_ARGUMENT_CHARS
      ) {
        throw new Error('MCP tool arguments are too large')
      }
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
      const unsupportedContent = result.content.find(
        (content) => content.type !== 'text',
      )
      if (unsupportedContent) {
        throw new Error(
          `Tool result with content type ${unsupportedContent.type} is not currently supported.`,
        )
      }
      const text = this.collectToolOutput(result.content)
      if (result.isError) {
        return {
          status: ToolCallResponseStatus.Error,
          error: this.boundAndRedactToolOutput(text, serverConfigForRedaction),
        }
      }
      return {
        status: ToolCallResponseStatus.Success,
        data: {
          type: 'text',
          text: this.boundAndRedactToolOutput(text, serverConfigForRedaction),
        },
      }
    } catch (error) {
      if (
        compositeSignal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
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
      signal?.removeEventListener('abort', abortFromCaller)
      if (
        id !== undefined &&
        this.activeToolCalls.get(id) === toolAbortController
      ) {
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

  private collectToolOutput(content: McpToolCallResult['content']): string {
    const output: string[] = []
    let outputLength = 0
    for (const item of content) {
      if (item.type !== 'text' || typeof item.text !== 'string') {
        throw new Error('Unsupported MCP tool result content')
      }
      const separator = outputLength > 0 ? '\n' : ''
      const remaining = MAX_MCP_RAW_TOOL_OUTPUT_CHARS - outputLength
      if (remaining <= 0) break
      const part = `${separator}${item.text}`.slice(0, remaining)
      output.push(part)
      outputLength += part.length
    }
    return output.join('')
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
