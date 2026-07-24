import { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { AbstractJsonRepository } from '../base'
import { CHAT_DIR, ROOT_DIR } from '../constants'
import { EmptyChatTitleException } from '../exception'
import {
  MAX_JSON_FILE_NAME_BYTES,
  encodeFileNameLabel,
  fitLabelToFileName,
} from '../file-name'

import {
  CHAT_SCHEMA_VERSION,
  ChatConversation,
  ChatConversationMetadata,
  isChatConversation,
  normalizeChatConversation,
} from './types'

const SAFE_CHAT_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const AMBIGUOUS_CHAT_ID_PATTERN = /(?:^|_)\d+_/

type StoredChat = {
  chat: ChatConversation
  fileName: string
}

export class ChatManager extends AbstractJsonRepository<
  ChatConversation,
  ChatConversationMetadata
> {
  private fileNameById = new Map<string, string>()

  constructor(app: App) {
    super(app, `${ROOT_DIR}/${CHAT_DIR}`)
  }

  protected generateFileName(chat: ChatConversation): string {
    // Format: v{schemaVersion}_{title}_{updatedAt}_{id}.json
    const title = this.fitTitle(chat.title, chat.updatedAt, chat.id)
    const encodedTitle = encodeFileNameLabel(title)
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

  protected normalizeRow(row: unknown): ChatConversation | null {
    return normalizeChatConversation(row)
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
    const id = initialData.id ?? uuidv4()
    this.validateId(id)
    const newChat: ChatConversation = {
      id,
      title: initialData.title ?? 'New chat',
      messages: initialData.messages ?? [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }

    await this.create(newChat)
    this.fileNameById.set(newChat.id, this.generateFileName(newChat))
    return newChat
  }

  public async importChat(
    chat: Omit<ChatConversation, 'schemaVersion'>,
  ): Promise<ChatConversation> {
    this.validateId(chat.id)
    if (chat.title.length === 0) {
      throw new EmptyChatTitleException()
    }
    const importedChat: ChatConversation = {
      id: chat.id,
      title: chat.title,
      messages: chat.messages,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      schemaVersion: CHAT_SCHEMA_VERSION,
    }
    await this.create(importedChat)
    this.fileNameById.set(importedChat.id, this.generateFileName(importedChat))

    const verifiedChat = await this.read(this.generateFileName(importedChat))
    if (
      !verifiedChat ||
      stringifyDeterministically(verifiedChat) !==
        stringifyDeterministically(importedChat)
    ) {
      throw new Error(`Failed to verify imported chat ${chat.id}`)
    }
    return verifiedChat
  }

  public async findById(id: string): Promise<ChatConversation | null> {
    return (await this.findStoredById(id))?.chat ?? null
  }

  public async updateChat(
    id: string,
    updates: Partial<
      Omit<ChatConversation, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<ChatConversation | null> {
    const stored = await this.findStoredById(id)
    if (!stored) return null
    const { chat, fileName } = stored

    if (updates.title !== undefined && updates.title.length === 0) {
      throw new EmptyChatTitleException()
    }
    if (
      (updates.title === undefined || updates.title === chat.title) &&
      (updates.messages === undefined ||
        stringifyDeterministically(updates.messages) ===
          stringifyDeterministically(chat.messages))
    ) {
      return chat
    }

    const updatedAt = Date.now()
    const updatedChat: ChatConversation = {
      ...chat,
      ...updates,
      updatedAt,
    }

    if (fileName === this.generateFileName(chat)) {
      await this.update(chat, updatedChat)
    } else {
      await this.create(updatedChat)
      await this.delete(fileName)
    }
    this.fileNameById.set(id, this.generateFileName(updatedChat))
    return updatedChat
  }

  public async deleteChat(id: string): Promise<boolean> {
    const fileNames = await this.listCandidateFileNames(id)
    const copies = new Set<string>()
    for (const fileName of fileNames) {
      const chat = await this.read(fileName)
      if (chat?.id === id && this.matchesStoredFileName(chat, fileName)) {
        copies.add(fileName)
      }
      try {
        if (this.parseFileName(fileName)?.id === id) copies.add(fileName)
      } catch {
        // Ignore malformed labels; valid rows were already matched above.
      }
    }
    if (copies.size === 0) return false

    for (const fileName of copies) await this.delete(fileName)
    this.fileNameById.delete(id)
    return true
  }

  public async listChats(): Promise<ChatConversationMetadata[]> {
    const candidatesById = new Map<
      string,
      (ChatConversationMetadata & { fileName: string })[]
    >()
    for (const metadata of await this.listMetadata()) {
      const candidates = candidatesById.get(metadata.id) ?? []
      candidates.push(metadata)
      candidatesById.set(metadata.id, candidates)
    }

    const chats = new Map<
      string,
      { metadata: ChatConversationMetadata; fileName: string }
    >()
    const remember = (metadata: ChatConversationMetadata, fileName: string) => {
      const current = chats.get(metadata.id)
      if (
        !current ||
        metadata.updatedAt > current.metadata.updatedAt ||
        (metadata.updatedAt === current.metadata.updatedAt &&
          fileName.localeCompare(current.fileName) < 0)
      ) {
        chats.set(metadata.id, { metadata, fileName })
      }
    }
    this.fileNameById.clear()
    for (const candidates of candidatesById.values()) {
      const needsRowValidation =
        candidates.length > 1 ||
        candidates.some(
          ({ fileName, title }) =>
            fileName.length >= MAX_JSON_FILE_NAME_BYTES - 12 ||
            AMBIGUOUS_CHAT_ID_PATTERN.test(title),
        )
      if (needsRowValidation) {
        const stored = await this.selectStoredChat(
          candidates.map(({ fileName }) => fileName),
        )
        if (!stored) continue
        remember(
          {
            id: stored.chat.id,
            schemaVersion: stored.chat.schemaVersion,
            title: stored.chat.title,
            updatedAt: stored.chat.updatedAt,
          },
          stored.fileName,
        )
        continue
      }

      const [metadata] = candidates
      remember(
        {
          id: metadata.id,
          schemaVersion: metadata.schemaVersion,
          title: metadata.title,
          updatedAt: metadata.updatedAt,
        },
        metadata.fileName,
      )
    }
    for (const [id, { fileName }] of chats) {
      this.fileNameById.set(id, fileName)
    }
    return [...chats.values()]
      .map(({ metadata }) => metadata)
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      )
  }

  public async listChatConversations(): Promise<ChatConversation[]> {
    return (await this.listStoredChats()).map(({ chat }) => chat)
  }

  private async listStoredChats(): Promise<StoredChat[]> {
    const chats = new Map<string, StoredChat>()
    for (const fileName of await this.listJsonFileNames()) {
      const chat = await this.read(fileName)
      if (!chat || !this.matchesStoredFileName(chat, fileName)) continue
      const existing = chats.get(chat.id)
      if (
        existing &&
        (existing.chat.updatedAt > chat.updatedAt ||
          (existing.chat.updatedAt === chat.updatedAt &&
            existing.fileName.localeCompare(fileName) <= 0))
      ) {
        continue
      }
      chats.set(chat.id, { chat, fileName })
    }
    return [...chats.values()].sort(
      (left, right) =>
        right.chat.updatedAt - left.chat.updatedAt ||
        left.fileName.localeCompare(right.fileName),
    )
  }

  private async findStoredById(id: string): Promise<StoredChat | null> {
    const cachedFileName = this.fileNameById.get(id)
    if (cachedFileName) {
      const chat = await this.read(cachedFileName)
      if (chat?.id === id && this.matchesStoredFileName(chat, cachedFileName)) {
        return { chat, fileName: cachedFileName }
      }
      this.fileNameById.delete(id)
    }

    const selected = await this.selectStoredChat(
      await this.listCandidateFileNames(id),
      id,
    )
    if (selected) this.fileNameById.set(id, selected.fileName)
    return selected
  }

  private async selectStoredChat(
    fileNames: string[],
    expectedId?: string,
  ): Promise<StoredChat | null> {
    let selected: StoredChat | null = null
    for (const fileName of fileNames) {
      const chat = await this.read(fileName)
      if (
        !chat ||
        (expectedId !== undefined && chat.id !== expectedId) ||
        !this.matchesStoredFileName(chat, fileName)
      ) {
        continue
      }
      if (
        !selected ||
        chat.updatedAt > selected.chat.updatedAt ||
        (chat.updatedAt === selected.chat.updatedAt &&
          fileName.localeCompare(selected.fileName) < 0)
      ) {
        selected = { chat, fileName }
      }
    }
    return selected
  }

  private async listCandidateFileNames(id: string): Promise<string[]> {
    const fileNames = await this.listJsonFileNames()
    if (AMBIGUOUS_CHAT_ID_PATTERN.test(id)) return fileNames

    return fileNames.filter((fileName) => {
      try {
        return this.parseFileName(fileName)?.id === id
      } catch {
        return false
      }
    })
  }

  private matchesStoredFileName(
    chat: ChatConversation,
    fileName: string,
  ): boolean {
    try {
      if (fileName === this.generateFileName(chat)) return true
      const title = encodeURIComponent(chat.title)
      return (
        fileName ===
        `v${chat.schemaVersion}_${title}_${chat.updatedAt}_${chat.id}.json`
      )
    } catch {
      return false
    }
  }

  private fitTitle(title: string, updatedAt: number, id: string): string {
    return fitLabelToFileName(
      title,
      `v${CHAT_SCHEMA_VERSION}__${updatedAt}_${id}.json`.length,
    )
  }

  private validateId(id: string): void {
    if (!SAFE_CHAT_ID_PATTERN.test(id) || AMBIGUOUS_CHAT_ID_PATTERN.test(id)) {
      throw new Error(`Invalid chat ID: ${id}`)
    }
  }
}

const stringifyDeterministically = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, nested: unknown) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      return nested
    }
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    )
  })
