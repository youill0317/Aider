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
  equalServerToolOptions,
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
const MCP_CONNECTION_TIMEOUT_MS = 20_000
const MCP_CLIENT_CLOSE_TIMEOUT_MS = 2_000
const MAX_MCP_SERVER_TOOLS = 256
const MAX_MCP_SERVER_TOOL_CATALOG_CHARS = 1024 * 1024
const MAX_MCP_AVAILABLE_TOOLS = 512
const MAX_MCP_AVAILABLE_TOOL_CATALOG_CHARS = 1024 * 1024

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

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
  private pendingCloseTasks = new Set<Promise<void>>()
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
    if (!this.settings.chatOptions.enableTools) {
      this.updateServers(
        this.settings.mcp.servers.map((config) => ({
          name: config.id,
          config,
          status: McpServerStatus.Disconnected,
        })),
      )
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

  public async cleanup(): Promise<void> {
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

    if (this.unsubscribeFromSettings) {
      this.unsubscribeFromSettings()
    }

    this.servers = []
    this.availableToolsCache = null
    this.subscribers.clear()
    this.activeToolCalls.clear()
    this.allowedToolsByConversation.clear()
    await Promise.allSettled([
      this.closeClients([...clients]),
      ...this.pendingCloseTasks,
    ])
    this.pendingCloseTasks.clear()
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
    if (!settings.chatOptions.enableTools) {
      this.updateServers(
        settings.mcp.servers.map((config) => ({
          name: config.id,
          config,
          status: McpServerStatus.Disconnected,
        })),
      )
      return
    }

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
          equalServerToolOptions(
            existingServer.config.toolOptions,
            serverConfig.toolOptions,
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

  public async revokeServerTrust(serverId: string): Promise<void> {
    this.settingsRevision += 1
    await this.updateServers((servers) =>
      servers.map((server) =>
        server.name === serverId
          ? {
              name: server.name,
              config: server.config,
              status: server.config.enabled
                ? McpServerStatus.ApprovalRequired
                : McpServerStatus.Disconnected,
            }
          : server,
      ),
    )
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
    await Promise.allSettled(
      uniqueClients.map((client) =>
        withTimeout(
          Promise.resolve().then(() => client.close()),
          MCP_CLIENT_CLOSE_TIMEOUT_MS,
          'Timed out while closing MCP client',
        ),
      ),
    )
  }

  private closeClientsInBackground(clients: McpClient[]): Promise<void> {
    const closeTask = this.closeClients(clients)
    this.pendingCloseTasks.add(closeTask)
    void closeTask.then(() => this.pendingCloseTasks.delete(closeTask))
    return closeTask
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
  ): Promise<void> | undefined {
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

    const disconnectedServerNames = new Set(
      currentServers
        .filter(
          (server) =>
            server.status === McpServerStatus.Connected &&
            clientsToDisconnect.includes(server.client),
        )
        .map((server) => server.name),
    )
    if (disconnectedServerNames.size > 0) {
      for (const [conversationId, allowedTools] of this
        .allowedToolsByConversation) {
        for (const requestToolName of allowedTools) {
          if (
            disconnectedServerNames.has(
              parseToolName(requestToolName).serverName,
            )
          ) {
            allowedTools.delete(requestToolName)
          }
        }
        if (allowedTools.size === 0) {
          this.allowedToolsByConversation.delete(conversationId)
        }
      }
    }

    // Disconnect clients in the background
    let closeTask: Promise<void> | undefined
    if (clientsToDisconnect.length > 0) {
      closeTask = this.closeClientsInBackground(clientsToDisconnect)
    }

    this.servers = nextServers
    this.availableToolsCache = null // Invalidate available tools cache
    this.notifySubscribers() // Should call after invalidating the cache
    return closeTask
  }

  private async connectServer(
    serverConfig: McpServerConfig,
    revision = this.settingsRevision,
  ): Promise<McpServerState> {
    if (this.disabled) {
      throw new McpNotAvailableException()
    }

    const { id: name, parameters: serverParams, enabled } = serverConfig

    if (
      !enabled ||
      !this.settings.chatOptions.enableTools ||
      !this.isConnectionCurrent(revision)
    ) {
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
      await withTimeout(
        client.connect(
          new StdioClientTransport({
            ...serverParams,
            stderr: 'ignore',
            env: {
              ...this.defaultEnv,
              ...(serverParams.env ?? {}),
            },
          }),
        ),
        MCP_CONNECTION_TIMEOUT_MS,
        `MCP server ${name} connection timed out`,
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
      const tools = await withTimeout(
        this.listServerTools(client),
        MCP_CONNECTION_TIMEOUT_MS,
        `MCP server ${name} tool discovery timed out`,
      )
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
        tools,
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
    const availableTools: McpTool[] = []
    let catalogChars = 0
    collectTools: for (const server of this.servers) {
      if (server.status !== McpServerStatus.Connected) {
        continue
      }
      for (const tool of server.tools) {
        if (server.config.toolOptions[tool.name]?.disabled) continue
        const availableTool = {
          ...tool,
          name: getToolName(server.name, tool.name),
        }
        const serializedChars = JSON.stringify(availableTool)?.length ?? 0
        if (
          availableTools.length >= MAX_MCP_AVAILABLE_TOOLS ||
          catalogChars + serializedChars > MAX_MCP_AVAILABLE_TOOL_CATALOG_CHARS
        ) {
          break collectTools
        }
        availableTools.push(availableTool)
        catalogChars += serializedChars
      }
    }

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

  private async listServerTools(client: McpClient): Promise<McpTool[]> {
    const tools: McpTool[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined

    for (;;) {
      const page =
        cursor === undefined
          ? await client.listTools()
          : await client.listTools({ cursor })
      tools.push(...page.tools)
      this.assertToolCatalogWithinBounds(tools)
      if (page.nextCursor === undefined) return tools
      if (seenCursors.has(page.nextCursor)) {
        throw new Error('MCP server returned a repeated tool cursor')
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
  }

  private assertToolCatalogWithinBounds(tools: McpTool[]): void {
    if (tools.length > MAX_MCP_SERVER_TOOLS) {
      throw new Error(
        `MCP server advertised more than ${MAX_MCP_SERVER_TOOLS} tools`,
      )
    }
    let serializedChars = 0
    for (const tool of tools) {
      serializedChars += JSON.stringify(tool)?.length ?? 0
      if (serializedChars > MAX_MCP_SERVER_TOOL_CATALOG_CHARS) {
        throw new Error('MCP server tool catalog is too large')
      }
    }
  }
}
