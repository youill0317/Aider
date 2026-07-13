import { z } from 'zod'

import { SerializedChatMessage } from '../../../types/chat'

export const CHAT_SCHEMA_VERSION = 1

export type ChatConversation = {
  id: string
  title: string
  messages: SerializedChatMessage[]
  createdAt: number
  updatedAt: number
  schemaVersion: number
}

export type ChatConversationMetadata = {
  id: string
  title: string
  updatedAt: number
  schemaVersion: number
}

const serializedChatMessageSchema = z.discriminatedUnion('role', [
  z
    .object({
      id: z.string(),
      role: z.literal('user'),
      content: z.union([z.record(z.unknown()), z.null()]),
      promptContent: z.union([z.string(), z.array(z.unknown()), z.null()]),
      mentionables: z.array(z.unknown()),
    })
    .passthrough(),
  z
    .object({
      id: z.string(),
      role: z.literal('assistant'),
      content: z.string(),
      reasoning: z.string().optional(),
      annotations: z.array(z.unknown()).optional(),
      toolCallRequests: z.array(z.unknown()).optional(),
    })
    .passthrough(),
  z
    .object({
      id: z.string(),
      role: z.literal('tool'),
      toolCalls: z.array(z.unknown()),
    })
    .passthrough(),
  z
    .object({
      id: z.string(),
      role: z.literal('agent-command'),
      title: z.string(),
      detail: z.string(),
      input: z.string(),
      output: z.string(),
      status: z.enum(['running', 'success', 'error']),
      kind: z.enum(['command', 'web-search', 'mcp-tool']),
      exitCode: z.number().nullable().optional(),
    })
    .passthrough(),
])

const chatConversationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1),
    messages: z.array(serializedChatMessageSchema),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    schemaVersion: z.literal(CHAT_SCHEMA_VERSION),
  })
  .passthrough()

export function isChatConversation(value: unknown): value is ChatConversation {
  return chatConversationSchema.safeParse(value).success
}
