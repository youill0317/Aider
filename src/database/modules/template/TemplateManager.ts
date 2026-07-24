import { PgliteDatabase } from 'drizzle-orm/pglite'

import { SelectTemplate } from '../../schema'

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

  async findAllTemplates(): Promise<SelectTemplate[]> {
    return await this.repository.findAll()
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
