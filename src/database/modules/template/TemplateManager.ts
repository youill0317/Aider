import { PgliteDatabase } from 'drizzle-orm/pglite'
import fuzzysort from 'fuzzysort'

import { DuplicateTemplateException } from '../../exception'
import { InsertTemplate, SelectTemplate } from '../../schema'

import { TemplateRepository } from './TemplateRepository'

export class LegacyTemplateManager {
  private repository: TemplateRepository
  private saveCallback: (() => Promise<void>) | null = null

  private async requestSave() {
    if (this.saveCallback) {
      await this.saveCallback()
    }
  }

  constructor(db: PgliteDatabase) {
    this.repository = new TemplateRepository(db)
  }

  setSaveCallback(callback: () => Promise<void>) {
    this.saveCallback = callback
  }

  async createTemplate(template: InsertTemplate): Promise<SelectTemplate> {
    const existingTemplate = await this.repository.findByName(template.name)
    if (existingTemplate) {
      throw new DuplicateTemplateException(template.name)
    }
    const created = await this.repository.create(template)
    await this.requestSave()
    return created
  }

  async findAllTemplates(): Promise<SelectTemplate[]> {
    return await this.repository.findAll()
  }

  async searchTemplates(query: string): Promise<SelectTemplate[]> {
    const templates = await this.findAllTemplates()
    const results = fuzzysort.go(query, templates, {
      keys: ['name'],
      threshold: 0.2,
      limit: 20,
      all: true,
    })
    return results.map((result) => result.obj)
  }

  async deleteTemplate(id: string, save = true): Promise<boolean> {
    const deleted = await this.repository.delete(id)
    if (save) await this.requestSave()
    return deleted
  }

  async saveChanges(): Promise<void> {
    await this.requestSave()
  }
}
