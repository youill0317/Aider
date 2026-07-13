import { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { AbstractJsonRepository } from '../base'
import { CHAT_DIR, ROOT_DIR } from '../constants'
import { EmptyChatTitleException } from '../exception'

import {
  CHAT_SCHEMA_VERSION,
  ChatConversation,
  ChatConversationMetadata,
  isChatConversation,
} from './types'

const SAFE_CHAT_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export class ChatManager extends AbstractJsonRepository<
  ChatConversation,
  ChatConversationMetadata
> {
  constructor(app: App) {
    super(app, `${ROOT_DIR}/${CHAT_DIR}`)
  }

  protected generateFileName(chat: ChatConversation): string {
    // Format: v{schemaVersion}_{title}_{updatedAt}_{id}.json
    const encodedTitle = encodeURIComponent(chat.title)
    return `v${chat.schemaVersion}_${encodedTitle}_${chat.updatedAt}_${chat.id}.json`
  }

  protected parseFileName(fileName: string): ChatConversationMetadata | null {
    // Parse: v{schemaVersion}_{title}_{updatedAt}_{id}.json
    const regex = new RegExp(
      `^v${CHAT_SCHEMA_VERSION}_(.+)_(\\d+)_([A-Za-z0-9_-]+)\\.json$`,
    )
    const match = fileName.match(regex)
    if (!match) return null

    const title = decodeURIComponent(match[1])
    const updatedAt = parseInt(match[2], 10)
    const id = match[3]
    if (!SAFE_CHAT_ID_PATTERN.test(id)) return null

    return {
      id,
      schemaVersion: CHAT_SCHEMA_VERSION,
      title,
      updatedAt,
    }
  }

  protected isValidRow(row: unknown): row is ChatConversation {
    return isChatConversation(row)
  }

  public async createChat(
    initialData: Partial<
      Pick<ChatConversation, 'id' | 'title' | 'messages'>
    > = {},
  ): Promise<ChatConversation> {
    if (initialData.title !== undefined && initialData.title.length === 0) {
      throw new EmptyChatTitleException()
    }

    const now = Date.now()
    const newChat: ChatConversation = {
      id: initialData.id ?? uuidv4(),
      title: initialData.title ?? 'New chat',
      messages: initialData.messages ?? [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    this.validateId(newChat.id)

    await this.create(newChat)
    return newChat
  }

  public async importChat(
    chat: Omit<ChatConversation, 'schemaVersion'>,
  ): Promise<void> {
    this.validateId(chat.id)
    await this.create({
      id: chat.id,
      title: chat.title,
      messages: chat.messages,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      schemaVersion: CHAT_SCHEMA_VERSION,
    })
  }

  public async findById(id: string): Promise<ChatConversation | null> {
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.id === id)

    if (!targetMetadata) return null

    return this.read(targetMetadata.fileName)
  }

  public async updateChat(
    id: string,
    updates: Partial<
      Omit<ChatConversation, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<ChatConversation | null> {
    const chat = await this.findById(id)
    if (!chat) return null

    if (updates.title !== undefined && updates.title.length === 0) {
      throw new EmptyChatTitleException()
    }

    const updatedChat: ChatConversation = {
      ...chat,
      ...updates,
      updatedAt: Date.now(),
    }

    await this.update(chat, updatedChat)
    return updatedChat
  }

  public async deleteChat(id: string): Promise<boolean> {
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.id === id)
    if (!targetMetadata) return false

    await this.delete(targetMetadata.fileName)
    return true
  }

  public async listChats(): Promise<ChatConversationMetadata[]> {
    const metadata = await this.listMetadata()
    return metadata.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private validateId(id: string): void {
    if (!SAFE_CHAT_ID_PATTERN.test(id)) {
      throw new Error(`Invalid chat ID: ${id}`)
    }
  }
}
