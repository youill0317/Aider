import { App, normalizePath } from 'obsidian'

import { ChatConversationManager } from '../../utils/chat/chatHistoryManager'
import { DatabaseManager } from '../DatabaseManager'
import { DuplicateTemplateException } from '../exception'

import { writeFileAtomically } from './base'
import { ChatManager } from './chat/ChatManager'
import { INITIAL_MIGRATION_MARKER, ROOT_DIR } from './constants'
import { TemplateManager } from './template/TemplateManager'

async function hasMigrationCompleted(app: App): Promise<boolean> {
  const markerPath = normalizePath(`${ROOT_DIR}/${INITIAL_MIGRATION_MARKER}`)
  return await app.vault.adapter.exists(markerPath)
}

async function markMigrationCompleted(app: App): Promise<void> {
  const rootPath = normalizePath(ROOT_DIR)
  if (!(await app.vault.adapter.exists(rootPath))) {
    try {
      await app.vault.adapter.mkdir(rootPath)
    } catch (error) {
      if (!(await app.vault.adapter.exists(rootPath))) {
        throw error
      }
    }
  }
  const markerPath = normalizePath(`${ROOT_DIR}/${INITIAL_MIGRATION_MARKER}`)
  await writeFileAtomically(
    app.vault.adapter,
    markerPath,
    `Migration completed on ${new Date().toISOString()}`,
  )
}

async function transferChatHistoryFromLegacy(app: App): Promise<number> {
  const oldChatManager = new ChatConversationManager(app)
  const newChatManager = new ChatManager(app)

  const chatList = await oldChatManager.getChatList()
  let failures = 0

  for (const chatMeta of chatList) {
    try {
      const oldChat = await oldChatManager.findChatConversation(chatMeta.id)
      if (!oldChat) {
        throw new Error(`Legacy chat ${chatMeta.id} was not found`)
      }

      const existingChat = await newChatManager.findById(oldChat.id)
      if (existingChat) {
        continue
      }

      await newChatManager.importChat({
        id: oldChat.id,
        title: oldChat.title,
        messages: oldChat.messages,
        createdAt: oldChat.createdAt,
        updatedAt: oldChat.updatedAt,
      })

      const verifyChat = await newChatManager.findById(oldChat.id)
      if (!verifyChat) {
        throw new Error(`Failed to verify migration of chat ${oldChat.id}`)
      }

      await oldChatManager.deleteChatConversation(oldChat.id)
    } catch (error) {
      failures += 1
      console.error(`Error migrating chat ${chatMeta.id}:`, error)
    }
  }

  console.log('Chat history migration to JSON database completed')
  return failures
}

async function transferTemplatesFromDrizzle(
  app: App,
  dbManager: DatabaseManager,
): Promise<number> {
  const jsonTemplateManager = new TemplateManager(app)
  const drizzleTemplateManager = dbManager.getTemplateManager()

  const templates = await drizzleTemplateManager.findAllTemplates()
  let failures = 0

  for (const template of templates) {
    try {
      if (await jsonTemplateManager.findByName(template.name)) {
        // Template already exists, skip
        continue
      }
      await jsonTemplateManager.createTemplate({
        name: template.name,
        content: template.content,
      })

      const verifyTemplate = await jsonTemplateManager.findByName(template.name)
      if (!verifyTemplate) {
        throw new Error(
          `Failed to verify migration of template ${template.name}`,
        )
      }

      await drizzleTemplateManager.deleteTemplate(template.id)
    } catch (error) {
      if (error instanceof DuplicateTemplateException) {
        console.log(`Duplicate template found: ${template.name}. Skipping...`)
      } else {
        failures += 1
        console.error(`Error migrating template ${template.name}:`, error)
      }
    }
  }

  console.log('Templates migration to JSON database completed')
  return failures
}

export async function migrateToJsonDatabase(
  app: App,
  getDatabaseManager: () => Promise<DatabaseManager>,
  onMigrationComplete?: () => void | Promise<void>,
): Promise<void> {
  if (await hasMigrationCompleted(app)) {
    return
  }

  const chatFailures = await transferChatHistoryFromLegacy(app)
  const dbManager = await getDatabaseManager()
  const templateFailures = await transferTemplatesFromDrizzle(app, dbManager)
  const failures = chatFailures + templateFailures
  if (failures > 0) {
    throw new Error(`JSON database migration failed for ${failures} record(s)`)
  }
  await markMigrationCompleted(app)
  await onMigrationComplete?.()
}
