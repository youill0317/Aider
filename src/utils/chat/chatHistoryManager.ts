/**
 * LEGACY CHAT MANAGER
 * This implementation has been deprecated and replaced by the JSON database implementation
 * in src/database/json/chat/ChatManager.ts
 *
 * This file is kept for backward compatibility and migration purposes.
 */

import { App, normalizePath } from 'obsidian'

import { ChatConversation, ChatConversationMeta } from '../../types/chat'

const CURRENT_SCHEMA_VERSION = 3
const SUPPORTED_SCHEMA_VERSION = 2
export const CHAT_HISTORY_DIR = '.aider_chat_histories'
export const LEGACY_CHAT_HISTORY_DIR = '.smtcmp_chat_histories'
const CHAT_LIST_FILE = 'chat_list.json'
const SAFE_CHAT_CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export class ChatConversationManager {
  private app: App

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
    const filePath = this.getChatConversationPath(id)
    await this.app.vault.adapter.remove(filePath)
    const chatList = await this.getChatList()
    const updatedChatList = chatList.filter((chat) => chat.id !== id)
    await this.app.vault.adapter.write(
      this.getChatListPath(),
      JSON.stringify(updatedChatList),
    )
  }

  async findChatConversation(id: string): Promise<ChatConversation | null> {
    const filePath = this.getChatConversationPath(id)
    if (await this.app.vault.adapter.exists(filePath)) {
      const content = await this.app.vault.adapter.read(filePath)
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
      const content = await this.app.vault.adapter.read(chatListPath)
      const chatList: unknown = JSON.parse(content)
      if (!Array.isArray(chatList)) {
        return []
      }
      const chatItems: unknown[] = chatList
      return chatItems.filter(
        // TODO: should migrate from 2 to 3
        (chat): chat is ChatConversationMeta =>
          this.isChatConversationMeta(chat) &&
          chat.schemaVersion >= SUPPORTED_SCHEMA_VERSION,
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
