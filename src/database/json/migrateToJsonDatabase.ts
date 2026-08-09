import { App, normalizePath } from 'obsidian'

import { PGLITE_DB_PATH } from '../../constants'
import { AtomicWriteRecoveryError } from '../../utils/atomic-file'
import { ChatConversationManager } from '../../utils/chat/chatHistoryManager'
import { DatabaseManager } from '../DatabaseManager'

import { writeFileAtomically } from './base'
import { ChatManager } from './chat/ChatManager'
import {
  CHAT_SCHEMA_VERSION,
  type ChatConversation,
  normalizeChatConversation,
} from './chat/types'
import { INITIAL_MIGRATION_MARKER, ROOT_DIR } from './constants'
import { TemplateManager } from './template/TemplateManager'

async function hasMigrationCompleted(app: App): Promise<boolean> {
  const markerPath = normalizePath(`${ROOT_DIR}/${INITIAL_MIGRATION_MARKER}`)
  if (!(await app.vault.adapter.exists(markerPath))) return false
  const stat = await app.vault.adapter.stat(markerPath)
  if (stat?.type === 'file' && stat.size > 128) return false
  try {
    const content = await app.vault.adapter.read(markerPath)
    if (new Blob([content]).size > 128) return false
    const timestamp = content.match(/^Migration completed on (.+)$/)?.[1]
    return Boolean(
      timestamp &&
        Number.isFinite(Date.parse(timestamp)) &&
        new Date(timestamp).toISOString() === timestamp,
    )
  } catch {
    return false
  }
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

type MigrationResult = {
  failures: number
  imported: number
}

async function transferChatHistoryFromLegacy(
  app: App,
): Promise<MigrationResult> {
  const oldChatManager = new ChatConversationManager(app)
  const newChatManager = new ChatManager(app)

  const chatList = await oldChatManager.getChatList()
  const targetChats = new Map(
    (await newChatManager.listChatConversations()).map(
      (chat) => [chat.id, chat] as const,
    ),
  )
  let failures = 0
  let imported = 0
  const migratedIds: string[] = []

  for (const chatMeta of chatList) {
    try {
      const oldChat = await oldChatManager.findChatConversation(chatMeta.id)
      if (!oldChat) {
        continue
      }

      const normalizedChat = normalizeChatConversation({
        ...oldChat,
        schemaVersion: CHAT_SCHEMA_VERSION,
      })
      if (!normalizedChat) {
        throw new Error(`Invalid legacy chat ${oldChat.id}`)
      }

      const existingChat = targetChats.get(normalizedChat.id)
      if (existingChat) {
        if (!matchesImportedChat(existingChat, normalizedChat)) {
          throw new Error(`Conflicting target chat ${normalizedChat.id}`)
        }
        migratedIds.push(normalizedChat.id)
        continue
      }

      const importedChat = await newChatManager.importChat({
        id: normalizedChat.id,
        title: normalizedChat.title,
        messages: normalizedChat.messages,
        createdAt: normalizedChat.createdAt,
        updatedAt: normalizedChat.updatedAt,
      })

      if (!matchesImportedChat(importedChat, normalizedChat)) {
        throw new Error(
          `Failed to verify migration of chat ${normalizedChat.id}`,
        )
      }

      targetChats.set(importedChat.id, importedChat)
      migratedIds.push(normalizedChat.id)
      imported += 1
    } catch (error) {
      if (error instanceof AtomicWriteRecoveryError) throw error
      failures += 1
      console.error(`Error migrating chat ${chatMeta.id}:`, error)
    }
  }

  try {
    const cleanupFailures =
      await oldChatManager.deleteChatConversations(migratedIds)
    failures += cleanupFailures.length
    for (const id of cleanupFailures) {
      console.error(`Error deleting migrated legacy chat ${id}`)
    }
  } catch (error) {
    failures += 1
    console.error('Error cleaning up migrated legacy chats:', error)
  }

  console.log('Chat history migration to JSON database completed')
  return { failures, imported }
}

function matchesImportedChat(
  target: ChatConversation,
  source: ChatConversation,
): boolean {
  return (
    target.id === source.id &&
    target.title === source.title &&
    target.createdAt === source.createdAt &&
    target.updatedAt === source.updatedAt &&
    JSON.stringify(target.messages) === JSON.stringify(source.messages)
  )
}

async function transferTemplatesFromDrizzle(
  app: App,
  dbManager: DatabaseManager,
): Promise<MigrationResult> {
  const jsonTemplateManager = new TemplateManager(app)
  const drizzleTemplateManager = dbManager.getTemplateManager()

  const templates = await drizzleTemplateManager.findAllTemplates()
  const targetTemplates = new Map(
    (await jsonTemplateManager.listTemplates()).map(
      (template) => [template.name, template] as const,
    ),
  )
  let failures = 0
  let imported = 0
  let deletedAnyTemplate = false

  for (const template of templates) {
    try {
      const existingTemplate = targetTemplates.get(template.name)
      if (existingTemplate) {
        if (
          !hasSameTemplateContent(existingTemplate.content, template.content)
        ) {
          throw new Error(`Conflicting target template ${template.name}`)
        }
        deletedAnyTemplate =
          (await drizzleTemplateManager.deleteTemplate(template.id, false)) ||
          deletedAnyTemplate
        continue
      }
      const importedTemplate = await jsonTemplateManager.importTemplate({
        name: template.name,
        content: template.content,
      })

      if (
        importedTemplate.name !== template.name ||
        !hasSameTemplateContent(importedTemplate.content, template.content)
      ) {
        throw new Error(
          `Failed to verify migration of template ${template.name}`,
        )
      }

      targetTemplates.set(importedTemplate.name, importedTemplate)
      imported += 1

      deletedAnyTemplate =
        (await drizzleTemplateManager.deleteTemplate(template.id, false)) ||
        deletedAnyTemplate
    } catch (error) {
      if (error instanceof AtomicWriteRecoveryError) throw error
      failures += 1
      console.error(`Error migrating template ${template.name}:`, error)
    }
  }

  if (deletedAnyTemplate) {
    await drizzleTemplateManager.saveChanges()
  }

  console.log('Templates migration to JSON database completed')
  return { failures, imported }
}

function hasSameTemplateContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function migrateToJsonDatabase(
  app: App,
  getDatabaseManager: () => Promise<DatabaseManager>,
  onMigrationComplete?: () => void | Promise<void>,
  finalizeMigration = true,
): Promise<boolean> {
  if (await hasMigrationCompleted(app)) {
    return false
  }

  const chatResult = await transferChatHistoryFromLegacy(app)
  const templateResult = (await app.vault.adapter.exists(
    normalizePath(PGLITE_DB_PATH),
  ))
    ? await transferTemplatesFromDrizzle(app, await getDatabaseManager())
    : { failures: 0, imported: 0 }
  const failures = chatResult.failures + templateResult.failures
  if (failures > 0) {
    throw new Error(`JSON database migration failed for ${failures} record(s)`)
  }
  if (finalizeMigration) {
    await markMigrationCompleted(app)
  }
  const imported = chatResult.imported + templateResult.imported > 0
  if (imported) await onMigrationComplete?.()
  return imported
}
