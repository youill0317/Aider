import { normalizePath } from 'obsidian'

import { completed, failed, missing } from './aiderAdoptionOutcomes'
import type {
  AdoptionOutcome,
  AdoptionPaths,
  AiderAdoptionAdapter,
  AiderAdoptionApp,
} from './aiderAdoptionTypes'
import {
  ensureFolderTree,
  hasNumberProperty,
  hasStringProperty,
  parseJsonObject,
  parseJsonValue,
} from './aiderAdoptionUtils'

type ChatHistoryMeta = {
  readonly schemaVersion: number
  readonly id: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
}

export async function adoptChatHistories(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  const legacyListPath = normalizePath(
    `${paths.legacyChatHistoryDir}/chat_list.json`,
  )
  if (!(await adapter.exists(legacyListPath))) {
    return missing(paths.legacyChatHistoryDir, paths.canonicalChatHistoryDir)
  }

  const legacyList = parseChatHistoryList(await adapter.read(legacyListPath))
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
  const canonicalList = await readChatHistoryList(adapter, canonicalListPath)
  const canonicalIds = new Set(canonicalList.map((chat) => chat.id))
  const adoptedMetas = [...canonicalList]
  let skippedMalformedFiles = 0

  for (const legacyMeta of legacyList) {
    if (canonicalIds.has(legacyMeta.id)) {
      continue
    }

    const legacyChatPath = normalizePath(
      `${paths.legacyChatHistoryDir}/${legacyMeta.id}.json`,
    )
    const canonicalChatPath = normalizePath(
      `${paths.canonicalChatHistoryDir}/${legacyMeta.id}.json`,
    )
    const legacyChatContent = await readLegacyChatContent(
      adapter,
      legacyChatPath,
    )
    if (legacyChatContent === null) {
      skippedMalformedFiles += 1
      continue
    }

    const legacyChat = parseJsonObject(legacyChatContent)

    if (
      !hasStringProperty(legacyChat, 'id') ||
      legacyChat.id !== legacyMeta.id
    ) {
      skippedMalformedFiles += 1
      continue
    }

    if (!(await adapter.exists(canonicalChatPath))) {
      await adapter.write(canonicalChatPath, legacyChatContent)
    }
    adoptedMetas.push(legacyMeta)
    canonicalIds.add(legacyMeta.id)
  }

  if (adoptedMetas.length !== canonicalList.length) {
    await adapter.write(
      canonicalListPath,
      stringifyChatHistoryList(adoptedMetas),
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
): Promise<readonly ChatHistoryMeta[]> {
  if (!(await adapter.exists(listPath))) {
    return []
  }

  return parseChatHistoryList(await adapter.read(listPath)) ?? []
}

function stringifyChatHistoryList(metas: readonly ChatHistoryMeta[]): string {
  return JSON.stringify(
    [...metas].sort((left, right) => right.updatedAt - left.updatedAt),
    null,
    2,
  )
}

async function readLegacyChatContent(
  adapter: AiderAdoptionAdapter,
  path: string,
): Promise<string | null> {
  try {
    return await adapter.read(path)
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }
}

function parseChatHistoryList(
  content: string,
): readonly ChatHistoryMeta[] | null {
  const value = parseJsonValue(content)
  if (value === null || !Array.isArray(value)) {
    return null
  }

  return value
    .map(parseChatHistoryMeta)
    .filter((meta): meta is ChatHistoryMeta => meta !== null)
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
