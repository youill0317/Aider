import { z } from 'zod'

export const baseLlmProviderSchema = z.object({
  id: z.string().min(1, 'id is required').max(128),
  baseUrl: z.string().max(4_096).optional(),
  apiKey: z
    .string()
    .max(1024 * 1024)
    .optional(),
  additionalSettings: z
    .record(z.string().max(256), z.string().max(16_384))
    .superRefine((settings, context) => {
      if (Object.keys(settings).length > 256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provider has too many additional settings',
        })
      }
    })
    .optional(),
})

/**
 * When adding a new provider, make sure to update these files:
 * - src/constants.ts
 * - src/types/chat-model.types.ts
 * - src/types/embedding-model.types.ts
 * - src/core/llm/manager.ts
 */
export const llmProviderSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('anthropic-plan'),
    ...baseLlmProviderSchema.shape,
    oauth: z
      .object({
        accessToken: z.string().max(1024 * 1024),
        refreshToken: z.string().max(1024 * 1024),
        expiresAt: z.number().finite(),
        accountId: z.string().max(4_096).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('openai-plan'),
    ...baseLlmProviderSchema.shape,
    oauth: z
      .object({
        accessToken: z.string().max(1024 * 1024),
        refreshToken: z.string().max(1024 * 1024),
        expiresAt: z.number().finite(),
        accountId: z.string().max(4_096).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('gemini-plan'),
    ...baseLlmProviderSchema.shape,
    oauth: z
      .object({
        accessToken: z.string().max(1024 * 1024),
        refreshToken: z.string().max(1024 * 1024),
        expiresAt: z.number().finite(),
        projectId: z.string().max(4_096).optional(),
        managedProjectId: z.string().max(4_096).optional(),
        email: z.string().max(4_096).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('anthropic'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('openai'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('gemini'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('xai'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('deepseek'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('perplexity'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('mistral'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('voyage'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('openrouter'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('ollama'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('lm-studio'),
    ...baseLlmProviderSchema.shape,
  }),
  z.object({
    type: z.literal('azure-openai'),
    ...baseLlmProviderSchema.shape,
    additionalSettings: z.object({
      deployment: z
        .string({
          required_error: 'deployment is required',
        })
        .min(1, 'deployment is required')
        .max(4_096),
      apiVersion: z
        .string({
          required_error: 'apiVersion is required',
        })
        .min(1, 'apiVersion is required')
        .max(4_096),
    }),
  }),
  z.object({
    type: z.literal('openai-compatible'),
    ...baseLlmProviderSchema.shape,
    baseUrl: z
      .string({
        required_error: 'base URL is required',
      })
      .min(1, 'base URL is required')
      .max(4_096),
    additionalSettings: z
      .object({
        noStainless: z.boolean().optional(),
      })
      .optional(),
  }),
])

export type LLMProvider = z.infer<typeof llmProviderSchema>
export type LLMProviderType = LLMProvider['type']
