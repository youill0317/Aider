/**
 * LEGACY CHAT MANAGER
 * This implementation has been deprecated and replaced by the JSON database implementation
 * in src/database/json/chat/ChatManager.ts
 *
 * This file is kept for backward compatibility and migration purposes.
 */

import { App, normalizePath } from 'obsidian'

import {
  MAX_ADOPTION_JSON_FILES,
  createAdoptionReadBudget,
  readBoundedTextFile,
} from '../../adoption/aiderAdoptionUtils'
import { ChatConversation, ChatConversationMeta } from '../../types/chat'

const CURRENT_SCHEMA_VERSION = 3
const SUPPORTED_SCHEMA_VERSION = 2
export const CHAT_HISTORY_DIR = '.aider_chat_histories'
export const LEGACY_CHAT_HISTORY_DIR = '.smtcmp_chat_histories'
const CHAT_LIST_FILE = 'chat_list.json'
const SAFE_CHAT_CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export class ChatConversationManager {
  private app: App
  private readonly readBudget = createAdoptionReadBudget()

  constructor(app: App) {
    this.app = app
  }

  async createChatConversation(id: string): Promise<ChatConversation> {
    const newChatConversation: ChatConversation = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      title: 'New chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    await this.saveChatConversation(newChatConversation)
    return newChatConversation
  }

  async deleteChatConversation(id: string): Promise<void> {
    const failures = await this.deleteChatConversations([id])
    if (failures.length > 0) {
      throw new Error(`Failed to delete chat conversation ${id}`)
    }
  }

  async deleteChatConversations(ids: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(ids)]
    const paths = uniqueIds.map(
      (id) => [id, this.getChatConversationPath(id)] as const,
    )
    const deletedIds = new Set<string>()
    const failedIds: string[] = []

    for (const [id, path] of paths) {
      try {
        await this.app.vault.adapter.remove(path)
        deletedIds.add(id)
      } catch {
        failedIds.push(id)
      }
    }

    if (deletedIds.size > 0) {
      const chatList = await this.getChatList()
      await this.app.vault.adapter.write(
        this.getChatListPath(),
        JSON.stringify(chatList.filter((chat) => !deletedIds.has(chat.id))),
      )
    }
    return failedIds
  }

  async findChatConversation(id: string): Promise<ChatConversation | null> {
    const filePath = this.getChatConversationPath(id)
    if (await this.app.vault.adapter.exists(filePath)) {
      const content = await readBoundedTextFile(
        this.app.vault.adapter,
        filePath,
        this.readBudget,
      )
      const chatConversation: unknown = JSON.parse(content)
      return this.isChatConversation(chatConversation, id)
        ? chatConversation
        : null
    }
    return null
  }

  async saveChatConversation(
    chatConversation: ChatConversation,
  ): Promise<void> {
    const filePath = this.getChatConversationPath(chatConversation.id)
    await this.ensureChatConversationDir()
    await this.app.vault.adapter.write(
      filePath,
      JSON.stringify(chatConversation),
    )
    await this.updateChatList(chatConversation)
  }

  async getChatList(): Promise<ChatConversationMeta[]> {
    const chatListPath = this.getChatListPath()
    if (await this.app.vault.adapter.exists(chatListPath)) {
      const content = await readBoundedTextFile(
        this.app.vault.adapter,
        chatListPath,
        this.readBudget,
      )
      const chatList: unknown = JSON.parse(content)
      if (!Array.isArray(chatList)) {
        return []
      }
      if (chatList.length > MAX_ADOPTION_JSON_FILES) {
        throw new Error('Legacy chat list exceeds the entry limit')
      }
      const chatItems: unknown[] = chatList
      return chatItems.filter((chat): chat is ChatConversationMeta =>
        this.isChatConversationMeta(chat),
      )
    }
    return []
  }

  private async ensureChatConversationDir() {
    const dirPath = normalizePath(CHAT_HISTORY_DIR)
    if (!(await this.app.vault.adapter.exists(dirPath))) {
      await this.app.vault.createFolder(dirPath)
    }
  }

  private async updateChatList(
    chatConversation: ChatConversation,
  ): Promise<void> {
    const chatList = await this.getChatList()
    const chatMeta: ChatConversationMeta = {
      schemaVersion: chatConversation.schemaVersion,
      id: chatConversation.id,
      title: chatConversation.title,
      createdAt: chatConversation.createdAt,
      updatedAt: chatConversation.updatedAt,
    }
    const existingIndex = chatList.findIndex(
      (chat) => chat.id === chatConversation.id,
    )
    if (existingIndex !== -1) {
      chatList[existingIndex] = chatMeta
    } else {
      chatList.push(chatMeta)
    }
    chatList.sort((a, b) => b.updatedAt - a.updatedAt)
    await this.app.vault.adapter.write(
      this.getChatListPath(),
      JSON.stringify(chatList),
    )
  }

  private getChatListPath(): string {
    return normalizePath(`${CHAT_HISTORY_DIR}/${CHAT_LIST_FILE}`)
  }

  private getChatConversationPath(id: string): string {
    if (!this.isSafeChatConversationId(id)) {
      throw new Error('Invalid chat conversation id')
    }
    return normalizePath(`${CHAT_HISTORY_DIR}/${id}.json`)
  }

  private isSafeChatConversationId(id: unknown): id is string {
    return typeof id === 'string' && SAFE_CHAT_CONVERSATION_ID_PATTERN.test(id)
  }

  private isChatConversationMeta(
    value: unknown,
  ): value is ChatConversationMeta {
    return (
      isRecord(value) &&
      this.isSafeChatConversationId(value.id) &&
      typeof value.schemaVersion === 'number' &&
      Number.isSafeInteger(value.schemaVersion) &&
      value.schemaVersion >= SUPPORTED_SCHEMA_VERSION &&
      value.schemaVersion <= CURRENT_SCHEMA_VERSION &&
      typeof value.title === 'string' &&
      typeof value.createdAt === 'number' &&
      typeof value.updatedAt === 'number'
    )
  }

  private isChatConversation(
    value: unknown,
    expectedId: string,
  ): value is ChatConversation {
    const messages = isRecord(value) ? value.messages : undefined
    return (
      this.isChatConversationMeta(value) &&
      value.id === expectedId &&
      Array.isArray(messages)
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
