import { z } from 'zod'

import { SerializedChatMessage } from '../../../types/chat'
import {
  MAX_MENTIONABLE_IMAGES,
  MAX_MENTIONABLE_IMAGE_DATA_CHARS,
  MAX_MENTIONABLE_IMAGE_TOTAL_DATA_CHARS,
} from '../../../types/mentionable'

export const CHAT_SCHEMA_VERSION = 1

const MAX_CHAT_MESSAGES = 10_000
const MAX_MESSAGE_CHARS = 16 * 1024 * 1024
const MAX_TOOL_ARGUMENT_CHARS = 1024 * 1024
const MAX_MESSAGE_COLLECTION_ITEMS = 512
const MAX_MENTIONABLES = 256
const MAX_PATH_CHARS = 4_096

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

const boundedIdSchema = z.string().min(1).max(256)
const boundedPathSchema = z.string().max(MAX_PATH_CHARS)
const serializedEditorStateSchema = z.custom<Record<string, unknown>>(
  isValidSerializedEditorState,
  'Invalid serialized editor state',
)

const contentPartSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().max(MAX_MESSAGE_CHARS),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string().max(MAX_MENTIONABLE_IMAGE_DATA_CHARS),
    }),
  }),
])

const annotationSchema = z.object({
  type: z.literal('url_citation'),
  url_citation: z.object({
    url: z.string().max(16_384),
    title: z.string().max(16_384).optional(),
    start_index: z.number().int().nonnegative().optional(),
    end_index: z.number().int().nonnegative().optional(),
  }),
})

const similaritySearchResultSchema = z.object({
  id: z.number().int(),
  path: boundedPathSchema,
  mtime: z.number().finite(),
  content: z.string().max(MAX_MESSAGE_CHARS),
  model: z.string().min(1).max(512),
  dimension: z.number().int().min(1).max(32_767),
  metadata: z.record(z.unknown()),
  similarity: z.number().finite(),
})

const responseUsageSchema = z.object({
  prompt_tokens: z.number().finite().nonnegative(),
  completion_tokens: z.number().finite().nonnegative(),
  total_tokens: z.number().finite().nonnegative(),
})

const codexResumeContextSchema = z.object({
  threadId: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  cwd: boundedPathSchema,
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  approvalPolicy: z.preprocess(
    (value) => (value === 'default' ? 'on-request' : value),
    z.enum(['never', 'on-request', 'untrusted']),
  ),
})

const assistantMetadataSchema = z.object({
  usage: responseUsageSchema.optional(),
  model: z.record(z.unknown()).optional(),
  agentSession: codexResumeContextSchema.nullable().optional(),
})

const providerMetadataSchema = z.object({
  gemini: z
    .object({
      thoughtSignature: z.string().max(MAX_TOOL_ARGUMENT_CHARS).optional(),
    })
    .optional(),
  deepseek: z
    .object({ reasoningContent: z.string().max(MAX_MESSAGE_CHARS).optional() })
    .optional(),
})

const serializedMentionableSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), file: boundedPathSchema }).passthrough(),
  z
    .object({ type: z.literal('folder'), folder: boundedPathSchema })
    .passthrough(),
  z.object({ type: z.literal('vault') }).passthrough(),
  z
    .object({
      type: z.literal('current-file'),
      file: z.union([boundedPathSchema, z.null()]),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('block'),
      content: z.string().max(MAX_MESSAGE_CHARS),
      file: boundedPathSchema,
      startLine: z.number().int().nonnegative(),
      endLine: z.number().int().nonnegative(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('url'),
      url: z.string().max(2_048),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('image'),
      name: z.string().max(1_024),
      mimeType: z.string().max(256),
      data: z.string().max(MAX_MENTIONABLE_IMAGE_DATA_CHARS),
    })
    .passthrough(),
])

const toolCallRequestSchema = z
  .object({
    id: boundedIdSchema,
    name: z.string().min(1).max(512),
    arguments: z.string().max(MAX_TOOL_ARGUMENT_CHARS).optional(),
  })
  .passthrough()

const toolCallResponseSchema = z.union([
  z.object({
    status: z.enum(['pending_approval', 'rejected', 'running', 'aborted']),
  }),
  z.object({
    status: z.literal('success'),
    data: z.object({
      type: z.literal('text'),
      text: z.string().max(MAX_MESSAGE_CHARS),
      codexSession: codexResumeContextSchema.optional(),
    }),
  }),
  z.object({
    status: z.literal('error'),
    error: z.string().max(MAX_MESSAGE_CHARS),
  }),
])

const serializedChatMessageSchema = z.union([
  z
    .object({
      id: boundedIdSchema,
      role: z.literal('user'),
      content: z.union([serializedEditorStateSchema, z.null()]),
      promptContent: z.union([
        z.string().max(MAX_MESSAGE_CHARS),
        z.array(contentPartSchema).max(MAX_MESSAGE_COLLECTION_ITEMS),
        z.null(),
      ]),
      mentionables: z.array(serializedMentionableSchema).max(MAX_MENTIONABLES),
      similaritySearchResults: z
        .array(similaritySearchResultSchema)
        .max(MAX_MESSAGE_COLLECTION_ITEMS)
        .optional(),
    })
    .passthrough(),
  z
    .object({
      id: boundedIdSchema,
      role: z.literal('assistant'),
      content: z.string().max(MAX_MESSAGE_CHARS),
      reasoning: z.string().max(MAX_MESSAGE_CHARS).optional(),
      annotations: z
        .array(annotationSchema)
        .max(MAX_MESSAGE_COLLECTION_ITEMS)
        .optional(),
      toolCallRequests: z
        .array(toolCallRequestSchema)
        .max(MAX_MESSAGE_COLLECTION_ITEMS)
        .optional(),
      metadata: assistantMetadataSchema.optional(),
      providerMetadata: providerMetadataSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      id: boundedIdSchema,
      role: z.literal('tool'),
      toolCalls: z
        .array(
          z.object({
            request: toolCallRequestSchema,
            response: toolCallResponseSchema,
          }),
        )
        .max(MAX_MESSAGE_COLLECTION_ITEMS),
    })
    .passthrough(),
  z
    .object({
      id: boundedIdSchema,
      role: z.literal('agent-command'),
      title: z.string().max(4_096),
      detail: z.string().max(MAX_MESSAGE_CHARS),
      input: z.string().max(MAX_MESSAGE_CHARS),
      output: z.string().max(MAX_MESSAGE_CHARS),
      status: z.enum(['running', 'success', 'error']),
      kind: z.enum(['command', 'web-search', 'mcp-tool']),
      exitCode: z.number().nullable().optional(),
    })
    .passthrough(),
])

const chatConversationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    title: z.string().min(1).max(4_096),
    messages: z.array(serializedChatMessageSchema).max(MAX_CHAT_MESSAGES),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    schemaVersion: z.literal(CHAT_SCHEMA_VERSION),
  })
  .passthrough()
  .superRefine((conversation, context) => {
    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index]
      if (
        message.role === 'user' &&
        message.mentionables.filter(({ type }) => type === 'image').length >
          MAX_MENTIONABLE_IMAGES
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Chat message contains too many images',
          path: ['messages', index, 'mentionables'],
        })
      }
      if (
        message.role === 'user' &&
        message.mentionables.reduce(
          (total, mentionable) =>
            total +
            (mentionable.type === 'image' ? mentionable.data.length : 0),
          0,
        ) > MAX_MENTIONABLE_IMAGE_TOTAL_DATA_CHARS
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Chat message images exceed the total size limit',
          path: ['messages', index, 'mentionables'],
        })
      }
    }
  })

export function isChatConversation(value: unknown): value is ChatConversation {
  return chatConversationSchema.safeParse(value).success
}

export function normalizeChatConversation(
  value: unknown,
): ChatConversation | null {
  const normalized = normalizeLegacyAgentCommands(value)
  const parsed = chatConversationSchema.safeParse(normalized)
  return parsed.success ? (parsed.data as ChatConversation) : null
}

function normalizeLegacyAgentCommands(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.messages)) return value
  return {
    ...value,
    messages: value.messages.map((message: unknown) => {
      if (
        !isRecord(message) ||
        message.role !== 'agent-command' ||
        typeof message.command !== 'string' ||
        (typeof message.title === 'string' &&
          typeof message.detail === 'string' &&
          typeof message.input === 'string' &&
          typeof message.kind === 'string')
      ) {
        return message
      }
      return {
        ...message,
        title: message.command,
        detail: '',
        input: message.command,
        kind: 'command',
      }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidSerializedEditorState(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.root)) return false
  if (
    value.root.type !== 'root' ||
    !Number.isInteger(value.root.version) ||
    !Array.isArray(value.root.children)
  ) {
    return false
  }

  const pending: { node: unknown; depth: number }[] = [
    { node: value.root, depth: 0 },
  ]
  let nodeCount = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || !isRecord(current.node) || current.depth > 128) {
      return false
    }
    if (
      typeof current.node.type !== 'string' ||
      current.node.type.length === 0 ||
      current.node.type.length > 256 ||
      !Number.isInteger(current.node.version)
    ) {
      return false
    }
    nodeCount += 1
    if (nodeCount > 10_000) return false

    if (current.node.children !== undefined) {
      if (!Array.isArray(current.node.children)) return false
      for (const child of current.node.children) {
        pending.push({ node: child, depth: current.depth + 1 })
      }
    }
  }
  return true
}
