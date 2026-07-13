import { SerializedLexicalNode } from 'lexical'
import { z } from 'zod'

export const TEMPLATE_SCHEMA_VERSION = 1

export type Template = {
  id: string
  name: string
  content: { nodes: SerializedLexicalNode[] }
  createdAt: number
  updatedAt: number
  schemaVersion: number
}

export type TemplateMetadata = {
  id: string
  name: string
  schemaVersion: number
}

const templateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    content: z
      .object({
        nodes: z.array(
          z
            .object({ type: z.string(), version: z.number().finite() })
            .passthrough(),
        ),
      })
      .passthrough(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  })
  .passthrough()

export function isTemplate(value: unknown): value is Template {
  return templateSchema.safeParse(value).success
}
