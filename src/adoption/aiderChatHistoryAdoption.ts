import { normalizePath } from 'obsidian'

import { writeFileAtomically } from '../utils/atomic-file'

import { completed, failed, missing } from './aiderAdoptionOutcomes'
import type {
  AdoptionOutcome,
  AdoptionPaths,
  AiderAdoptionAdapter,
  AiderAdoptionApp,
} from './aiderAdoptionTypes'
import {
  type AdoptionReadBudget,
  MAX_ADOPTION_JSON_FILES,
  createAdoptionReadBudget,
  ensureFolderTree,
  hasNumberProperty,
  hasStringProperty,
  parseJsonObject,
  parseJsonValue,
  readBoundedTextFile,
} from './aiderAdoptionUtils'

const SAFE_LEGACY_CHAT_ID_PATTERN = /^[A-Za-z0-9_-]+$/

type ChatHistoryMeta = {
  readonly schemaVersion: number
  readonly id: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
}

type ChatHistory = ChatHistoryMeta & {
  readonly messages: readonly unknown[]
}

export async function adoptChatHistories(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  const readBudget = createAdoptionReadBudget()
  const legacyListPath = normalizePath(
    `${paths.legacyChatHistoryDir}/chat_list.json`,
  )
  if (!(await adapter.exists(legacyListPath))) {
    return missing(paths.legacyChatHistoryDir, paths.canonicalChatHistoryDir)
  }

  const legacyList = parseChatHistoryList(
    await readBoundedTextFile(adapter, legacyListPath, readBudget),
  )
  if (legacyList === null) {
    return failed(
      paths.legacyChatHistoryDir,
      paths.canonicalChatHistoryDir,
      'Legacy chat history list is malformed',
    )
  }

  await ensureFolderTree(adapter, paths.canonicalChatHistoryDir)
  const canonicalListPath = normalizePath(
    `${paths.canonicalChatHistoryDir}/chat_list.json`,
  )
  const canonicalList = await readChatHistoryList(
    adapter,
    canonicalListPath,
    readBudget,
  )
  if (canonicalList === null) {
    return failed(
      paths.legacyChatHistoryDir,
      paths.canonicalChatHistoryDir,
      'Canonical chat history list is malformed',
    )
  }
  const adoptedMetas = new Map<string, ChatHistoryMeta>()
  let listChanged = false
  for (const meta of canonicalList) {
    if (adoptedMetas.has(meta.id)) {
      listChanged = true
    } else {
      adoptedMetas.set(meta.id, meta)
    }
  }
  let skippedMalformedFiles = 0

  for (const legacyMeta of legacyList) {
    if (!isSafeLegacyChatId(legacyMeta.id)) {
      skippedMalformedFiles += 1
      continue
    }

    const legacyChatPath = normalizePath(
      `${paths.legacyChatHistoryDir}/${legacyMeta.id}.json`,
    )
    const canonicalChatPath = normalizePath(
      `${paths.canonicalChatHistoryDir}/${legacyMeta.id}.json`,
    )

    const canonicalChatContent = await readChatContent(
      adapter,
      canonicalChatPath,
      readBudget,
    )
    const canonicalChat = parseChatHistory(canonicalChatContent)
    if (canonicalChat?.id === legacyMeta.id) {
      const canonicalMeta = toChatHistoryMeta(canonicalChat)
      if (
        !sameChatHistoryMeta(adoptedMetas.get(legacyMeta.id), canonicalMeta)
      ) {
        adoptedMetas.set(legacyMeta.id, canonicalMeta)
        listChanged = true
      }
      continue
    }

    const legacyChatContent = await readChatContent(
      adapter,
      legacyChatPath,
      readBudget,
    )
    const legacyChat = parseChatHistory(legacyChatContent)
    if (
      legacyChatContent === null ||
      !legacyChat ||
      !sameChatHistoryMeta(legacyChat, legacyMeta)
    ) {
      skippedMalformedFiles += 1
      continue
    }

    await writeFileAtomically(adapter, canonicalChatPath, legacyChatContent)
    if (!sameChatHistoryMeta(adoptedMetas.get(legacyMeta.id), legacyMeta)) {
      adoptedMetas.set(legacyMeta.id, legacyMeta)
      listChanged = true
    }
  }

  if (listChanged) {
    await writeFileAtomically(
      adapter,
      canonicalListPath,
      stringifyChatHistoryList([...adoptedMetas.values()]),
    )
  }

  if (skippedMalformedFiles > 0) {
    return failed(
      paths.legacyChatHistoryDir,
      paths.canonicalChatHistoryDir,
      `Skipped ${skippedMalformedFiles} malformed legacy chat file(s)`,
    )
  }

  return completed(paths.legacyChatHistoryDir, paths.canonicalChatHistoryDir)
}

async function readChatHistoryList(
  adapter: AiderAdoptionAdapter,
  listPath: string,
  readBudget: AdoptionReadBudget,
): Promise<readonly ChatHistoryMeta[] | null> {
  if (!(await adapter.exists(listPath))) {
    return []
  }

  return parseChatHistoryList(
    await readBoundedTextFile(adapter, listPath, readBudget),
  )
}

function stringifyChatHistoryList(metas: readonly ChatHistoryMeta[]): string {
  return JSON.stringify(
    [...metas].sort((left, right) => right.updatedAt - left.updatedAt),
    null,
    2,
  )
}

async function readChatContent(
  adapter: AiderAdoptionAdapter,
  path: string,
  readBudget?: AdoptionReadBudget,
): Promise<string | null> {
  return (await adapter.exists(path))
    ? readBoundedTextFile(
        adapter,
        path,
        readBudget ?? createAdoptionReadBudget(),
      )
    : null
}

function parseChatHistory(content: string | null): ChatHistory | null {
  if (content === null) return null
  const value = parseJsonObject(content)
  const messages = value?.messages
  if (
    !hasNumberProperty(value, 'schemaVersion') ||
    !hasStringProperty(value, 'id') ||
    !isSafeLegacyChatId(value.id) ||
    !hasStringProperty(value, 'title') ||
    !hasNumberProperty(value, 'createdAt') ||
    !hasNumberProperty(value, 'updatedAt') ||
    !Array.isArray(messages)
  ) {
    return null
  }

  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages,
  }
}

function toChatHistoryMeta(chat: ChatHistory): ChatHistoryMeta {
  return {
    schemaVersion: chat.schemaVersion,
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  }
}

function sameChatHistoryMeta(
  left: ChatHistoryMeta | undefined,
  right: ChatHistoryMeta,
): boolean {
  return (
    left?.schemaVersion === right.schemaVersion &&
    left.id === right.id &&
    left.title === right.title &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  )
}

function parseChatHistoryList(
  content: string,
): readonly ChatHistoryMeta[] | null {
  const value = parseJsonValue(content)
  if (value === null || !Array.isArray(value)) {
    return null
  }
  if (value.length > MAX_ADOPTION_JSON_FILES) {
    return null
  }

  const metas = value.map(parseChatHistoryMeta)
  return metas.some((meta) => meta === null)
    ? null
    : (metas as ChatHistoryMeta[])
}

function parseChatHistoryMeta(value: unknown): ChatHistoryMeta | null {
  if (
    !hasNumberProperty(value, 'schemaVersion') ||
    !hasStringProperty(value, 'id') ||
    !hasStringProperty(value, 'title') ||
    !hasNumberProperty(value, 'createdAt') ||
    !hasNumberProperty(value, 'updatedAt')
  ) {
    return null
  }

  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function isSafeLegacyChatId(id: string): boolean {
  return SAFE_LEGACY_CHAT_ID_PATTERN.test(id)
}
