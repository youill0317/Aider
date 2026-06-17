import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  McpClient,
  McpServerStatus,
  McpTool,
  McpToolCallResult,
} from '../../types/mcp.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { redactMcpError } from './mcp-security'
import { McpManager } from './mcpManager'
import { getToolName } from './tool-name-utils'

describe('McpManager permission boundaries', () => {
  it('disabled tool is not available', async () => {
    // Given: a connected server whose only tool is disabled in settings.
    const manager = createManager({
      toolOptions: {
        search: {
          disabled: true,
        },
      },
    })

    // When: available tools are listed.
    const tools = await manager.listAvailableTools()

    // Then: the disabled tool is excluded.
    expect(tools).toEqual([])
  })

  it('auto-execute requires explicit tool option', () => {
    // Given: a connected tool without an explicit tool option.
    const manager = createManager({
      toolOptions: {},
    })

    // When/Then: auto execution is denied by default.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(false)
  })

  it('conversation allow permits advertised tool without stored option', async () => {
    // Given: a connected server advertises a tool with no stored tool option.
    const client = createClient()
    const callToolSpy = jest.spyOn(client, 'callTool')
    const manager = createManager({
      toolOptions: {},
      client,
    })
    const requestToolName = getToolName('github', 'search')

    // When: the user explicitly allows the tool for one conversation.
    manager.allowToolForConversation(requestToolName, 'conversation-a')

    // Then: manual approval works without enabling auto-execution.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-a',
      }),
    ).toBe(true)
    const response = await manager.callTool({
      name: requestToolName,
      args: '{}',
    })
    expect(response.status).toBe(ToolCallResponseStatus.Success)
    expect(callToolSpy).toHaveBeenCalled()
  })

  it('allows persistent auto-execute when explicitly enabled', () => {
    // Given: a connected tool with explicit persistent auto-execute enabled.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: execution is allowed without a conversation-scoped allow.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(true)
  })

  it('denies unknown server tool names', () => {
    // Given: a manager connected only to the github server.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: a tool name for an unknown server is denied.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('unknown', 'search'),
      }),
    ).toBe(false)
  })

  it('malformed tool name is denied', () => {
    // Given: a manager with a valid connected server.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: malformed tool names fail closed.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: 'malformed-tool-name',
      }),
    ).toBe(false)
  })

  it('unknown server is denied', () => {
    // Given: a manager connected only to the github server.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: an unknown server is denied.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('unknown', 'search'),
      }),
    ).toBe(false)
  })

  it('unknown tool on known server is denied', async () => {
    // Given: settings contain tool options for a tool the server did not advertise.
    const client = createClient()
    const callToolSpy = jest.spyOn(client, 'callTool')
    const manager = createManager({
      toolOptions: {
        missing: {
          allowAutoExecution: true,
        },
      },
      client,
    })

    // When/Then: execution permission and direct tool calls both fail closed.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'missing'),
      }),
    ).toBe(false)
    const response = await manager.callTool({
      name: getToolName('github', 'missing'),
      args: '{}',
    })
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    expect(callToolSpy).not.toHaveBeenCalled()
  })

  it('disconnected server is denied', () => {
    // Given: a manager whose server is disconnected.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
      status: McpServerStatus.Disconnected,
    })

    // When/Then: tools on disconnected servers are denied.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(false)
  })

  it('disabled tool cannot be auto-executed', () => {
    // Given: a disabled tool also has auto-execute enabled.
    const manager = createManager({
      toolOptions: {
        search: {
          disabled: true,
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: disabled wins over auto-execute.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(false)
  })

  it('disabled tool cannot be called directly', async () => {
    // Given: a disabled tool is still present on a connected MCP client.
    const client = createClient()
    const callToolSpy = jest.spyOn(client, 'callTool')
    const manager = createManager({
      toolOptions: {
        search: {
          disabled: true,
          allowAutoExecution: true,
        },
      },
      client,
    })

    // When: the tool call bypasses the approval helper and reaches callTool.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: disabled tool execution fails closed before the client is invoked.
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    expect(callToolSpy).not.toHaveBeenCalled()
  })

  it('conversation allow cannot bypass disabled tool', () => {
    // Given: a disabled tool has been allowed for one conversation.
    const manager = createManager({
      toolOptions: {
        search: {
          disabled: true,
        },
      },
    })
    const requestToolName = getToolName('github', 'search')
    manager.allowToolForConversation(requestToolName, 'conversation-a')

    // When/Then: the disabled tool still cannot execute.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-a',
      }),
    ).toBe(false)
  })

  it('conversation allow does not persist', () => {
    // Given: a tool allowed for one conversation.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: false,
        },
      },
    })
    const requestToolName = getToolName('github', 'search')
    manager.allowToolForConversation(requestToolName, 'conversation-a')

    // When/Then: the allow applies only to the matching conversation.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-a',
      }),
    ).toBe(true)
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-b',
      }),
    ).toBe(false)
  })

  it('enabled tool with per-chat allow is scoped to conversation', () => {
    // Given: an enabled tool is allowed for one conversation.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: false,
        },
      },
    })
    const requestToolName = getToolName('github', 'search')
    manager.allowToolForConversation(requestToolName, 'conversation-a')

    // When/Then: allow is scoped to that conversation only.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-a',
      }),
    ).toBe(true)
    expect(
      manager.isToolExecutionAllowed({
        requestToolName,
        conversationId: 'conversation-b',
      }),
    ).toBe(false)
  })

  it('enabled tool with auto-execute is allowed', () => {
    // Given: an enabled tool has auto-execute enabled.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })

    // When/Then: the tool can execute automatically.
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(true)
  })

  it('settings update invalidates available tool cache', async () => {
    // Given: available tools have been cached for an enabled tool.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
    })
    await expect(manager.listAvailableTools()).resolves.toHaveLength(1)

    // When: settings update disables that tool.
    await manager.handleSettingsUpdate(
      createSettings({ search: { disabled: true } }),
    )

    // Then: available tools are recalculated and exclude the disabled tool.
    await expect(manager.listAvailableTools()).resolves.toEqual([])
  })

  it('mobile exposes no MCP execution path', async () => {
    // Given: a manager is forced into disabled mobile behavior.
    const manager = createManager({
      toolOptions: {
        search: {
          allowAutoExecution: true,
        },
      },
    })
    Object.defineProperty(manager, 'disabled', { value: true })

    // When/Then: mobile exposes no tools or tool execution.
    await expect(manager.listAvailableTools()).resolves.toEqual([])
    expect(
      manager.isToolExecutionAllowed({
        requestToolName: getToolName('github', 'search'),
      }),
    ).toBe(false)
  })

  it('MCP env secret is redacted from connection error', () => {
    // Given: an MCP error includes a configured env secret.
    const serverConfig = createSettings(
      {},
      {
        command: 'node',
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_PERSONAL_ACCESS_TOKEN_VALUE',
        },
      },
    ).mcp.servers[0]

    // When: production connection-error redaction handles the error message.
    const message = redactMcpError(
      'failed with GITHUB_PERSONAL_ACCESS_TOKEN_VALUE',
      serverConfig,
    )

    // Then: server diagnostics expose redacted context only.
    expect(message).toContain('[REDACTED]')
    expect(message).not.toContain('GITHUB_PERSONAL_ACCESS_TOKEN_VALUE')
  })

  it('MCP env secret is redacted from thrown tool call error', async () => {
    // Given: a connected MCP client throws a configured env secret.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
      parameters: {
        command: 'node',
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_PERSONAL_ACCESS_TOKEN_VALUE',
        },
      },
      callToolError: new Error(
        'failed with GITHUB_PERSONAL_ACCESS_TOKEN_VALUE',
      ),
    })

    // When: the tool call fails.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: the configured env secret is removed from the returned error.
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    if (response.status === ToolCallResponseStatus.Error) {
      expect(response.error).toContain('[REDACTED]')
      expect(response.error).not.toContain('GITHUB_PERSONAL_ACCESS_TOKEN_VALUE')
    }
  })

  it('inherited MCP env secret is redacted from thrown tool call error', async () => {
    // Given: a connected MCP client throws a secret inherited from default env.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
      callToolError: new Error('failed with INHERITED_OPENAI_KEY'),
    })
    const mutableManager = manager as unknown as {
      defaultEnv: Record<string, string>
      redactionEnvByServer: Map<string, Record<string, string>>
    }
    mutableManager.defaultEnv = {
      OPENAI_API_KEY: 'INHERITED_OPENAI_KEY',
    }
    mutableManager.redactionEnvByServer = new Map([
      [
        'github',
        {
          OPENAI_API_KEY: 'INHERITED_OPENAI_KEY',
        },
      ],
    ])

    // When: the tool call fails.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: inherited env secrets are removed from returned errors.
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    if (response.status === ToolCallResponseStatus.Error) {
      expect(response.error).toContain('[REDACTED]')
      expect(response.error).not.toContain('INHERITED_OPENAI_KEY')
    }
  })

  it('inherited MCP env secret is redacted from tool result error', async () => {
    // Given: a tool protocol error includes a secret inherited from default env.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
      callToolResult: {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'failed with INHERITED_OPENAI_KEY',
          },
        ],
      },
    })
    const mutableManager = manager as unknown as {
      redactionEnvByServer: Map<string, Record<string, string>>
    }
    mutableManager.redactionEnvByServer = new Map([
      [
        'github',
        {
          OPENAI_API_KEY: 'INHERITED_OPENAI_KEY',
        },
      ],
    ])

    // When: the tool returns an MCP error result.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: inherited env secrets are removed from protocol errors.
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    if (response.status === ToolCallResponseStatus.Error) {
      expect(response.error).toContain('[REDACTED]')
      expect(response.error).not.toContain('INHERITED_OPENAI_KEY')
    }
  })

  it('inherited MCP env secret is redacted from successful tool result', async () => {
    // Given: a successful tool result includes a secret inherited from default env.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
      callToolResult: {
        isError: false,
        content: [
          {
            type: 'text',
            text: 'result contains INHERITED_OPENAI_KEY',
          },
        ],
      },
    })
    const mutableManager = manager as unknown as {
      redactionEnvByServer: Map<string, Record<string, string>>
    }
    mutableManager.redactionEnvByServer = new Map([
      [
        'github',
        {
          OPENAI_API_KEY: 'INHERITED_OPENAI_KEY',
        },
      ],
    ])

    // When: the tool returns a successful MCP result.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: inherited env secrets are removed before UI display or prompt use.
    expect(response.status).toBe(ToolCallResponseStatus.Success)
    if (response.status === ToolCallResponseStatus.Success) {
      expect(response.data.text).toContain('[REDACTED]')
      expect(response.data.text).not.toContain('INHERITED_OPENAI_KEY')
    }
  })

  it('password-style MCP env secret is redacted from tool errors', async () => {
    // Given: a tool error includes a password-style inherited env secret.
    const manager = createManager({
      toolOptions: {
        search: {},
      },
      callToolResult: {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'failed with MCP_PASSWORD_VALUE',
          },
        ],
      },
    })
    const mutableManager = manager as unknown as {
      redactionEnvByServer: Map<string, Record<string, string>>
    }
    mutableManager.redactionEnvByServer = new Map([
      [
        'github',
        {
          MCP_PASSWORD: 'MCP_PASSWORD_VALUE',
        },
      ],
    ])

    // When: the tool returns an MCP error result.
    const response = await manager.callTool({
      name: getToolName('github', 'search'),
      args: '{}',
    })

    // Then: password-style env secrets are removed from protocol errors.
    expect(response.status).toBe(ToolCallResponseStatus.Error)
    if (response.status === ToolCallResponseStatus.Error) {
      expect(response.error).toContain('[REDACTED]')
      expect(response.error).not.toContain('MCP_PASSWORD_VALUE')
    }
  })

  it('MCP env redaction preserves non-secret context', () => {
    // Given: an MCP error includes both secret and non-secret env values.
    const serverConfig = createSettings(
      {},
      {
        command: 'node',
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: 'GITHUB_PERSONAL_ACCESS_TOKEN_VALUE',
          NORMAL_FLAG: 'debug',
        },
      },
    ).mcp.servers[0]

    // When: the error is redacted.
    const message = redactMcpError(
      'failed with GITHUB_PERSONAL_ACCESS_TOKEN_VALUE while NORMAL_FLAG=debug',
      serverConfig,
    )

    // Then: only the secret env value is removed.
    expect(message).toContain('[REDACTED]')
    expect(message).toContain('NORMAL_FLAG=debug')
    expect(message).not.toContain('GITHUB_PERSONAL_ACCESS_TOKEN_VALUE')
  })

  it('configured MCP env values are redacted even with non-token key names', () => {
    // Given: an MCP error includes configured env values under common non-token names.
    const serverConfig = createSettings(
      {},
      {
        command: 'node',
        env: {
          SSH_PRIVATE_KEY: 'SSH_PRIVATE_KEY_VALUE',
          AWS_ACCESS_KEY_ID: 'AWS_ACCESS_KEY_ID_VALUE',
          NORMAL_FLAG: 'debug',
        },
      },
    ).mcp.servers[0]

    // When: the error is redacted.
    const message = redactMcpError(
      'failed with SSH_PRIVATE_KEY_VALUE and AWS_ACCESS_KEY_ID_VALUE while NORMAL_FLAG=debug',
      serverConfig,
    )

    // Then: configured env values are removed without dropping ordinary context.
    expect(message).toContain('[REDACTED]')
    expect(message).toContain('NORMAL_FLAG=debug')
    expect(message).not.toContain('SSH_PRIVATE_KEY_VALUE')
    expect(message).not.toContain('AWS_ACCESS_KEY_ID_VALUE')
  })
})

function createManager(params: {
  readonly toolOptions: SmartComposerSettings['mcp']['servers'][number]['toolOptions']
  readonly parameters?: SmartComposerSettings['mcp']['servers'][number]['parameters']
  readonly status?: McpServerStatus
  readonly error?: Error
  readonly client?: McpClient
  readonly callToolError?: Error
  readonly callToolResult?: McpToolCallResult
}): McpManager {
  const manager = new McpManager({
    settings: createSettings(params.toolOptions, params.parameters),
    registerSettingsListener: () => () => undefined,
  })
  const mutableManager = manager as unknown as {
    servers: ReturnType<typeof createConnectedServer>[]
  }
  mutableManager.servers = [
    createConnectedServer({
      toolOptions: params.toolOptions,
      parameters: params.parameters,
      status: params.status,
      error: params.error,
      client: params.client,
      callToolError: params.callToolError,
      callToolResult: params.callToolResult,
    }),
  ]
  return manager
}

function createSettings(
  toolOptions: SmartComposerSettings['mcp']['servers'][number]['toolOptions'],
  parameters: SmartComposerSettings['mcp']['servers'][number]['parameters'] = {
    command: 'node',
  },
): SmartComposerSettings {
  return {
    version: 18,
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
      servers: [
        {
          id: 'github',
          enabled: true,
          parameters,
          toolOptions,
        },
      ],
    },
    chatOptions: {
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    },
    agent: {
      codex: {
        enabled: true,
        command: 'codex',
        defaultSandbox: 'workspace-write',
        approvalPolicy: 'default',
        cwdMode: 'vault',
        customCwd: '',
        resume: true,
      },
    },
  }
}

function createConnectedServer(params: {
  readonly toolOptions: SmartComposerSettings['mcp']['servers'][number]['toolOptions']
  readonly parameters?: SmartComposerSettings['mcp']['servers'][number]['parameters']
  readonly status?: McpServerStatus
  readonly error?: Error
  readonly client?: McpClient
  readonly callToolError?: Error
  readonly callToolResult?: McpToolCallResult
}) {
  const status = params.status ?? McpServerStatus.Connected
  const config = {
    id: 'github',
    enabled: true,
    parameters: params.parameters ?? {
      command: 'node',
    },
    toolOptions: params.toolOptions,
  }

  if (status === McpServerStatus.Disconnected) {
    return {
      name: 'github',
      config,
      status,
    }
  }

  if (status === McpServerStatus.Error) {
    return {
      name: 'github',
      config,
      status,
      error: params.error ?? new Error('failed'),
    }
  }

  return {
    name: 'github',
    config,
    status,
    client:
      params.client ??
      createClient({
        callToolError: params.callToolError,
        callToolResult: params.callToolResult,
      }),
    tools: [createTool('search')],
  }
}

function createClient({
  callToolError,
  callToolResult,
}: {
  readonly callToolError?: Error
  readonly callToolResult?: McpToolCallResult
} = {}): McpClient {
  const client = {
    listTools: async () => ({
      tools: [createTool('search')],
    }),
    callTool: async () => {
      if (callToolError) {
        throw callToolError
      }
      return (
        callToolResult ?? {
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
  }
  return client as unknown as McpClient
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
