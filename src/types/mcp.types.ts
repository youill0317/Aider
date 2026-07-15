import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types'
import { z } from 'zod'

export type McpTool = Tool
export type McpToolCallResult = CallToolResult
export type McpClient = Client

const MAX_MCP_PARAMETER_CHARS = 16_384
const MAX_MCP_ARGUMENTS = 256
const MAX_MCP_ENVIRONMENT_ENTRIES = 256
const MAX_MCP_TOOL_OPTIONS = 2_048

export const mcpServerParametersSchema = z.object({
  command: z.string().min(1).max(MAX_MCP_PARAMETER_CHARS),
  args: z
    .array(z.string().max(MAX_MCP_PARAMETER_CHARS))
    .max(MAX_MCP_ARGUMENTS)
    .optional(),
  env: z
    .record(
      z.string().max(MAX_MCP_PARAMETER_CHARS),
      z.string().max(MAX_MCP_PARAMETER_CHARS),
    )
    .superRefine((environment, context) => {
      if (Object.keys(environment).length > MAX_MCP_ENVIRONMENT_ENTRIES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MCP environment has too many entries',
        })
      }
    })
    .optional(),
})
export type McpServerParameters = z.infer<typeof mcpServerParametersSchema>

export const mcpServerToolOptionsSchema = z
  .record(
    z.string().max(MAX_MCP_PARAMETER_CHARS),
    z.object({
      disabled: z.boolean().optional(),
      allowAutoExecution: z.boolean().optional(),
    }),
  )
  .superRefine((toolOptions, context) => {
    if (Object.keys(toolOptions).length > MAX_MCP_TOOL_OPTIONS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MCP server has too many tool options',
      })
    }
  })

export const mcpServerConfigSchema = z.object({
  id: z.string().min(1).max(128),
  parameters: mcpServerParametersSchema,
  enabled: z.boolean(),
  toolOptions: mcpServerToolOptionsSchema,
})
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

export enum McpServerStatus {
  ApprovalRequired = 'approval-required',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

export type McpServerState = {
  name: string
  config: McpServerConfig
} & (
  | {
      status:
        | McpServerStatus.ApprovalRequired
        | McpServerStatus.Connecting
        | McpServerStatus.Disconnected
    }
  | {
      status: McpServerStatus.Connected
      client: McpClient
      tools: McpTool[]
    }
  | {
      status: McpServerStatus.Error
      error: Error
    }
)
