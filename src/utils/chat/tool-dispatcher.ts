import type { CodexToolRunner } from '../../core/agent/CodexToolRunner'
import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import type { CodexAgentEvent } from '../../core/agent/types'
import { McpManager } from '../../core/mcp/mcpManager'
import type { RequestTool } from '../../types/llm/request'
import type { McpTool } from '../../types/mcp.types'
import {
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'

export type ToolDispatcher = {
  listAvailableTools: () => Promise<RequestTool[]>
  isToolExecutionAllowed: (params: {
    readonly requestToolName: string
    readonly requestArgs?: string
    readonly conversationId?: string
  }) => boolean
  allowToolForConversation: (
    requestToolName: string,
    requestArgs: string | undefined,
    conversationId: string,
  ) => void
  callTool: (params: {
    readonly name: string
    readonly args?: string
    readonly id: string
    readonly onEvent?: (event: CodexAgentEvent) => void
    readonly signal?: AbortSignal
  }) => Promise<ToolCallResponse>
  abortToolCall: (id: string) => boolean
}

export function createToolDispatcher({
  mcpManager,
  codexToolRunner,
}: {
  readonly mcpManager: McpManager
  readonly codexToolRunner?: CodexToolRunner
}): ToolDispatcher {
  return {
    async listAvailableTools() {
      const mcpTools = await mcpManager.listAvailableTools()
      const requestTools = mcpTools.map(mcpToolToRequestTool)
      if (codexToolRunner?.isAvailable()) {
        requestTools.push(codexToolRunner.getToolDefinition())
      }
      return requestTools
    },

    isToolExecutionAllowed({ requestToolName, requestArgs, conversationId }) {
      if (requestToolName === CODEX_TOOL_NAME) {
        return (
          codexToolRunner?.isExecutionAllowed({
            requestArgs,
            conversationId,
          }) ?? false
        )
      }
      return mcpManager.isToolExecutionAllowed({
        requestToolName,
        conversationId,
      })
    },

    allowToolForConversation(requestToolName, requestArgs, conversationId) {
      if (requestToolName === CODEX_TOOL_NAME) {
        codexToolRunner?.allowToolForConversation(requestArgs, conversationId)
        return
      }
      mcpManager.allowToolForConversation(requestToolName, conversationId)
    },

    callTool({ name, args, id, onEvent, signal }) {
      if (name === CODEX_TOOL_NAME) {
        if (!codexToolRunner) {
          return Promise.resolve({
            status: ToolCallResponseStatus.Error,
            error: 'Codex tool is not available.',
          })
        }
        return codexToolRunner.callTool({ args, id, onEvent, signal })
      }
      return mcpManager.callTool({ name, args, id, signal })
    },

    abortToolCall(id) {
      return (
        mcpManager.abortToolCall(id) ||
        (codexToolRunner?.abortToolCall(id) ?? false)
      )
    },
  }
}

function mcpToolToRequestTool(tool: McpTool): RequestTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
      },
    },
  }
}
