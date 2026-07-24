import { z } from 'zod'

import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'
import { chatModelSchema } from '../../types/chat-model.types'
import { embeddingModelSchema } from '../../types/embedding-model.types'
import { mcpServerConfigSchema } from '../../types/mcp.types'
import { llmProviderSchema } from '../../types/provider.types'

import { SETTINGS_SCHEMA_VERSION } from './migrations'

const ragOptionsSchema = z.object({
  // LangChain's current splitter has a 200-character overlap.
  chunkSize: z.number().int().min(400).max(100_000).catch(1000),
  thresholdTokens: z.number().int().min(0).max(10_000_000).catch(8192),
  minSimilarity: z.number().min(-1).max(1).catch(0.0),
  limit: z.number().int().min(1).max(100).catch(10),
  excludePatterns: z.array(z.string().max(4_096)).max(256).catch([]),
  includePatterns: z.array(z.string().max(4_096)).max(256).catch([]),
})

type CodexAgentSettingsDefaults = {
  enabled: boolean
  command: string
  defaultSandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'default' | 'untrusted' | 'on-request' | 'never'
  cwdMode: 'vault' | 'custom'
  customCwd: string
  resume: boolean
}

const defaultCodexAgentSettings: CodexAgentSettingsDefaults = {
  enabled: true,
  command: 'codex',
  defaultSandbox: 'workspace-write',
  approvalPolicy: 'never',
  cwdMode: 'vault',
  customCwd: '',
  resume: true,
}

export const MAX_MCP_SERVERS = 32

const codexAgentSettingsSchema = z.object({
  enabled: z.boolean().catch(true),
  command: z.string().min(1).max(4_096).catch('codex'),
  defaultSandbox: z
    .enum(['read-only', 'workspace-write', 'danger-full-access'])
    .catch('workspace-write'),
  approvalPolicy: z
    .enum(['default', 'untrusted', 'on-request', 'never'])
    .catch('never'),
  cwdMode: z.enum(['vault', 'custom']).catch('vault'),
  customCwd: z.string().max(4_096).catch(''),
  resume: z.boolean().catch(true),
})

const agentSettingsSchema = z
  .object({
    codex: codexAgentSettingsSchema.catch(defaultCodexAgentSettings),
  })
  .catch({
    codex: defaultCodexAgentSettings,
  })

type SettingsWithIds = {
  readonly providers: readonly { readonly id: string }[]
  readonly chatModels: readonly { readonly id: string }[]
  readonly embeddingModels: readonly { readonly id: string }[]
  readonly mcp: {
    readonly servers: readonly { readonly id: string }[]
  }
}

function findDuplicateIdIndex(
  values: readonly { readonly id: string }[],
): number {
  const seen = new Set<string>()
  return values.findIndex(({ id }) => {
    if (seen.has(id)) return true
    seen.add(id)
    return false
  })
}

export function assertUniqueSettingsIds(settings: SettingsWithIds): void {
  if (findDuplicateIdIndex(settings.providers) >= 0) {
    throw new Error('Provider IDs must be unique')
  }
  if (findDuplicateIdIndex(settings.chatModels) >= 0) {
    throw new Error('Chat model IDs must be unique')
  }
  if (findDuplicateIdIndex(settings.embeddingModels) >= 0) {
    throw new Error('Embedding model IDs must be unique')
  }
  if (findDuplicateIdIndex(settings.mcp.servers) >= 0) {
    throw new Error('MCP server IDs must be unique')
  }
  if (settings.mcp.servers.length > MAX_MCP_SERVERS) {
    throw new Error(`MCP server count cannot exceed ${MAX_MCP_SERVERS}`)
  }
}

/**
 * Settings
 */

const smartComposerSettingsObjectSchema = z.object({
  // Version
  version: z.literal(SETTINGS_SCHEMA_VERSION).catch(SETTINGS_SCHEMA_VERSION),

  providers: z
    .array(llmProviderSchema)
    .max(128)
    .catch([...DEFAULT_PROVIDERS]),

  chatModels: z
    .array(chatModelSchema)
    .max(512)
    .catch([...DEFAULT_CHAT_MODELS]),

  embeddingModels: z
    .array(embeddingModelSchema)
    .max(128)
    .catch([...DEFAULT_EMBEDDING_MODELS]),

  chatModelId: z
    .string()
    .catch(
      DEFAULT_CHAT_MODELS.find((v) => v.id === DEFAULT_CHAT_MODEL_ID)?.id ??
        DEFAULT_CHAT_MODELS[0].id,
    ), // model for default chat feature
  applyModelId: z
    .string()
    .catch(
      DEFAULT_CHAT_MODELS.find((v) => v.id === DEFAULT_APPLY_MODEL_ID)?.id ??
        DEFAULT_CHAT_MODELS[0].id,
    ), // model for apply feature
  embeddingModelId: z.string().catch(DEFAULT_EMBEDDING_MODELS[0].id), // model for embedding

  // System Prompt
  systemPrompt: z
    .string()
    .max(1024 * 1024)
    .catch(''),

  // RAG Options
  ragOptions: ragOptionsSchema.catch({
    chunkSize: 1000,
    thresholdTokens: 8192,
    minSimilarity: 0.0,
    limit: 10,
    excludePatterns: [],
    includePatterns: [],
  }),

  // MCP configuration
  mcp: z
    .object({
      servers: z.array(mcpServerConfigSchema).max(MAX_MCP_SERVERS).catch([]),
    })
    .catch({
      servers: [],
    }),

  // Chat options
  chatOptions: z
    .object({
      includeCurrentFileContent: z.boolean(),
      enableTools: z.boolean(),
      maxAutoIterations: z.number().int().min(1).max(20).catch(1),
    })
    .catch({
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    }),

  agent: agentSettingsSchema,
})

export const smartComposerSettingsSchema =
  smartComposerSettingsObjectSchema.superRefine((settings, context) => {
    const providerIndex = findDuplicateIdIndex(settings.providers)
    if (providerIndex >= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider IDs must be unique',
        path: ['providers', providerIndex, 'id'],
      })
    }

    const chatModelIndex = findDuplicateIdIndex(settings.chatModels)
    if (chatModelIndex >= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chat model IDs must be unique',
        path: ['chatModels', chatModelIndex, 'id'],
      })
    }

    const embeddingModelIndex = findDuplicateIdIndex(settings.embeddingModels)
    if (embeddingModelIndex >= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Embedding model IDs must be unique',
        path: ['embeddingModels', embeddingModelIndex, 'id'],
      })
    }

    const serverIndex = findDuplicateIdIndex(settings.mcp.servers)
    if (serverIndex >= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MCP server IDs must be unique',
        path: ['mcp', 'servers', serverIndex, 'id'],
      })
    }

    const providersById = new Map(
      settings.providers.map((provider) => [provider.id, provider]),
    )
    const validateModelProviders = (
      models: readonly {
        readonly providerId: string
        readonly providerType: string
      }[],
      path: 'chatModels' | 'embeddingModels',
    ) => {
      models.forEach((model, index) => {
        const provider = providersById.get(model.providerId)
        if (!provider) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Provider ${model.providerId} does not exist`,
            path: [path, index, 'providerId'],
          })
        } else if (provider.type !== model.providerType) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Provider type must match ${provider.type}`,
            path: [path, index, 'providerType'],
          })
        }
      })
    }

    validateModelProviders(settings.chatModels, 'chatModels')
    validateModelProviders(settings.embeddingModels, 'embeddingModels')

    const validateSelectedChatModel = (
      field: 'chatModelId' | 'applyModelId',
    ) => {
      const model = settings.chatModels.find(({ id }) => id === settings[field])
      if (!model) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Selected model ${settings[field]} does not exist`,
          path: [field],
        })
      } else if (model.enable === false) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Selected model ${settings[field]} is disabled`,
          path: [field],
        })
      }
    }

    validateSelectedChatModel('chatModelId')
    validateSelectedChatModel('applyModelId')

    if (
      !settings.embeddingModels.some(
        ({ id }) => id === settings.embeddingModelId,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Selected model ${settings.embeddingModelId} does not exist`,
        path: ['embeddingModelId'],
      })
    }
  })
export type SmartComposerSettings = z.infer<typeof smartComposerSettingsSchema>
export type SmartComposerSettingsUpdate =
  | SmartComposerSettings
  | ((currentSettings: SmartComposerSettings) => SmartComposerSettings)

export type SettingMigration = {
  fromVersion: number
  toVersion: number
  migrate: (data: Record<string, unknown>) => Record<string, unknown>
}
