import { eq } from 'drizzle-orm'
import { PgliteDatabase } from 'drizzle-orm/pglite'

import { DatabaseNotInitializedException } from '../../exception'
import { type SelectTemplate, templateTable } from '../../schema'

export class TemplateRepository {
  private db: PgliteDatabase | null

  constructor(db: PgliteDatabase | null) {
    this.db = db
  }

  async findAll(): Promise<SelectTemplate[]> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    return await this.db.select().from(templateTable)
  }

  async delete(id: string): Promise<boolean> {
    if (!this.db) {
      throw new DatabaseNotInitializedException()
    }
    const [deleted] = await this.db
      .delete(templateTable)
      .where(eq(templateTable.id, id))
      .returning()
    return !!deleted
  }
}
