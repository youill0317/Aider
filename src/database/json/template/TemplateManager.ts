import * as fuzzysort from 'fuzzysort'
import { App } from 'obsidian'
import { v4 as uuidv4, validate as validateUuid } from 'uuid'

import { AbstractJsonRepository } from '../base'
import { ROOT_DIR, TEMPLATE_DIR } from '../constants'
import {
  DuplicateTemplateException,
  EmptyTemplateNameException,
} from '../exception'
import { encodeFileNameLabel, fitLabelToFileName } from '../file-name'

import {
  TEMPLATE_SCHEMA_VERSION,
  Template,
  TemplateMetadata,
  isTemplate,
} from './types'

type StoredTemplate = {
  fileName: string
  template: Template
}

type StoredTemplateMetadata = TemplateMetadata & {
  fileName: string
  updatedAt: number
}

type NewTemplate = Omit<
  Template,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
>

export class TemplateManager extends AbstractJsonRepository<
  Template,
  TemplateMetadata
> {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(app: App) {
    super(app, `${ROOT_DIR}/${TEMPLATE_DIR}`)
  }

  protected generateFileName(template: Template): string {
    // Format: v{schemaVersion}_name_id.json (with name encoded)
    const name = this.fitName(template.name, template.id)
    const encodedName = encodeFileNameLabel(name)
    return `v${TEMPLATE_SCHEMA_VERSION}_${encodedName}_${template.id}.json`
  }

  protected parseFileName(fileName: string): TemplateMetadata | null {
    const match = fileName.match(
      new RegExp(`^v${TEMPLATE_SCHEMA_VERSION}_(.+)_([0-9a-f-]+)\\.json$`),
    )
    if (!match) return null

    const encodedName = match[1]
    const id = match[2]
    if (!validateUuid(id)) return null
    const name = decodeURIComponent(encodedName)

    return { id, name, schemaVersion: TEMPLATE_SCHEMA_VERSION }
  }

  protected isValidRow(row: unknown): row is Template {
    return isTemplate(row)
  }

  public async createTemplate(template: NewTemplate): Promise<Template> {
    return this.enqueueMutation(() => this.createTemplateNow(template))
  }

  private async createTemplateNow(template: NewTemplate): Promise<Template> {
    if (template.name !== undefined && template.name.length === 0) {
      throw new EmptyTemplateNameException()
    }
    if (template.content.nodes.length === 0) {
      throw new Error('Template content cannot be empty')
    }

    const existingTemplate = await this.findByName(template.name)
    if (existingTemplate) {
      throw new DuplicateTemplateException(template.name)
    }

    return this.storeTemplate(uuidv4(), template)
  }

  public async importTemplate(template: NewTemplate): Promise<Template> {
    return this.enqueueMutation(async () => {
      if (template.name.length === 0) {
        throw new EmptyTemplateNameException()
      }
      if (template.content.nodes.length === 0) {
        throw new Error('Template content cannot be empty')
      }

      const importedTemplate = await this.storeTemplate(uuidv4(), template)
      const verifiedTemplate = await this.read(
        this.generateFileName(importedTemplate),
      )
      if (
        !verifiedTemplate ||
        JSON.stringify(verifiedTemplate) !== JSON.stringify(importedTemplate)
      ) {
        throw new Error(`Failed to verify imported template ${template.name}`)
      }
      return verifiedTemplate
    })
  }

  private async storeTemplate(
    id: string,
    template: NewTemplate,
  ): Promise<Template> {
    const now = Date.now()
    const newTemplate: Template = {
      id,
      name: template.name,
      content: template.content,
      createdAt: now,
      updatedAt: now,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }

    await this.create(newTemplate)
    return newTemplate
  }

  public async findById(id: string): Promise<Template | null> {
    return (await this.findValidatedTemplate({ id }))?.template ?? null
  }

  public async findByName(name: string): Promise<Template | null> {
    return (await this.findValidatedTemplate({ name }))?.template ?? null
  }

  public async listTemplates(): Promise<Template[]> {
    const templates = new Map<string, StoredTemplate>()
    for (const candidate of await this.listMetadata()) {
      const template = await this.read(candidate.fileName)
      if (
        !template ||
        template.id !== candidate.id ||
        template.schemaVersion !== candidate.schemaVersion ||
        (candidate.name !== template.name &&
          candidate.name !== this.fitName(template.name, template.id))
      ) {
        continue
      }
      const existing = templates.get(template.name)
      if (
        existing &&
        (existing.template.updatedAt > template.updatedAt ||
          (existing.template.updatedAt === template.updatedAt &&
            existing.fileName.localeCompare(candidate.fileName) <= 0))
      ) {
        continue
      }
      templates.set(template.name, {
        fileName: candidate.fileName,
        template,
      })
    }
    return [...templates.values()].map(({ template }) => template)
  }

  public async updateTemplate(
    id: string,
    updates: Partial<
      Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<Template | null> {
    return this.enqueueMutation(() => this.updateTemplateNow(id, updates))
  }

  private async updateTemplateNow(
    id: string,
    updates: Partial<
      Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<Template | null> {
    if (updates.name !== undefined && updates.name.length === 0) {
      throw new EmptyTemplateNameException()
    }
    if (updates.content?.nodes.length === 0) {
      throw new Error('Template content cannot be empty')
    }

    const stored = await this.findValidatedTemplate({ id })
    if (!stored) return null
    const { fileName, template } = stored

    const name = updates.name ?? template.name
    if (name !== template.name) {
      const existingTemplate = await this.findByName(name)
      if (existingTemplate) {
        throw new DuplicateTemplateException(name)
      }
    }

    const updatedTemplate: Template = {
      ...template,
      ...updates,
      name,
      updatedAt: Date.now(),
    }

    if (fileName === this.generateFileName(template)) {
      await this.update(template, updatedTemplate)
    } else {
      await this.create(updatedTemplate)
      await this.delete(fileName)
    }
    return updatedTemplate
  }

  public async deleteTemplate(id: string): Promise<boolean> {
    return this.enqueueMutation(() => this.deleteTemplateNow(id))
  }

  private async deleteTemplateNow(id: string): Promise<boolean> {
    const copies = (await this.listMetadata()).filter(
      (metadata) => metadata.id === id,
    )
    if (copies.length === 0) return false

    for (const { fileName } of copies) {
      await this.delete(fileName)
    }
    return true
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  public async searchTemplates(query: string): Promise<Template[]> {
    // Filename labels may be truncated, so search full validated rows.
    const results = fuzzysort.go(
      query,
      await this.listValidatedTemplateMetadata(),
      {
        keys: ['name'],
        threshold: 0.2,
        limit: 20,
        all: true,
      },
    )

    const templates: Template[] = []
    for (const result of results) {
      const candidate = result.obj
      const template = await this.read(candidate.fileName)
      if (
        template?.id === candidate.id &&
        template.name === candidate.name &&
        template.updatedAt === candidate.updatedAt &&
        template.schemaVersion === candidate.schemaVersion
      ) {
        templates.push(template)
      }
    }
    return templates
  }

  private async findValidatedTemplate(filter: {
    id?: string
    name?: string
  }): Promise<StoredTemplate | null> {
    const metadata = (await this.listMetadata()).filter(
      (candidate) =>
        (filter.id === undefined || candidate.id === filter.id) &&
        (filter.name === undefined ||
          candidate.name === filter.name ||
          candidate.name === this.fitName(filter.name, candidate.id)),
    )
    let selected: StoredTemplate | null = null
    for (const candidate of metadata) {
      const template = await this.read(candidate.fileName)
      if (
        !template ||
        template.id !== candidate.id ||
        (filter.name !== undefined && template.name !== filter.name) ||
        template.schemaVersion !== candidate.schemaVersion
      ) {
        continue
      }
      if (
        !selected ||
        template.updatedAt > selected.template.updatedAt ||
        (template.updatedAt === selected.template.updatedAt &&
          candidate.fileName.localeCompare(selected.fileName) < 0)
      ) {
        selected = { fileName: candidate.fileName, template }
      }
    }
    return selected
  }

  private async listValidatedTemplateMetadata(): Promise<
    StoredTemplateMetadata[]
  > {
    const templates = new Map<string, StoredTemplateMetadata>()
    for (const candidate of await this.listMetadata()) {
      const template = await this.read(candidate.fileName)
      if (
        !template ||
        template.id !== candidate.id ||
        template.schemaVersion !== candidate.schemaVersion
      ) {
        continue
      }
      const existing = templates.get(template.id)
      if (
        existing &&
        (existing.updatedAt > template.updatedAt ||
          (existing.updatedAt === template.updatedAt &&
            existing.fileName.localeCompare(candidate.fileName) <= 0))
      ) {
        continue
      }
      templates.set(template.id, {
        id: template.id,
        name: template.name,
        schemaVersion: template.schemaVersion,
        updatedAt: template.updatedAt,
        fileName: candidate.fileName,
      })
    }
    return [...templates.values()]
  }

  private fitName(name: string, id: string): string {
    return fitLabelToFileName(
      name,
      `v${TEMPLATE_SCHEMA_VERSION}__${id}.json`.length,
    )
  }
}
