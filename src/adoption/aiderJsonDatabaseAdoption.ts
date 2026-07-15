import { normalizePath } from 'obsidian'

import {
  isChatConversation,
  normalizeChatConversation,
} from '../database/json/chat/types'
import { CHAT_DIR, TEMPLATE_DIR } from '../database/json/constants'
import { isTemplate } from '../database/json/template/types'
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
  MAX_ADOPTION_DIRECTORY_DEPTH,
  MAX_ADOPTION_JSON_FILES,
  createAdoptionReadBudget,
  ensureFolderTree,
  parentPath,
  parseJsonObject,
  readBoundedTextFile,
  relativeDirectory,
  relativePath,
} from './aiderAdoptionUtils'

type JsonRecordConflictField = 'id' | 'name'
type JsonRecordKey = `${string}:${JsonRecordConflictField}:${string}`
type ParsedJsonRecord = {
  content: string
  keys: readonly JsonRecordKey[]
}

export async function adoptJsonDatabase(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  const readBudget = createAdoptionReadBudget()
  if (!(await adapter.exists(paths.legacyJsonRoot))) {
    return missing(paths.legacyJsonRoot, paths.canonicalJsonRoot)
  }

  await ensureFolderTree(adapter, paths.canonicalJsonRoot)
  const existingKeys = await collectJsonRecordKeys(
    adapter,
    paths.canonicalJsonRoot,
    readBudget,
  )
  const legacyFiles = [
    ...(await listJsonFilesRecursively(adapter, paths.legacyJsonRoot)),
  ].sort()
  let skippedMalformedFiles = 0

  for (const legacyFile of legacyFiles) {
    const content = await readBoundedTextFile(adapter, legacyFile, readBudget)
    const parsedRecord = parseJsonRecord(
      content,
      relativeDirectory(paths.legacyJsonRoot, legacyFile),
    )

    if (parsedRecord === null) {
      skippedMalformedFiles += 1
      continue
    }
    if (hasJsonRecordConflict(existingKeys, parsedRecord.keys)) {
      continue
    }

    const targetPath = normalizePath(
      `${paths.canonicalJsonRoot}/${relativePath(paths.legacyJsonRoot, legacyFile)}`,
    )
    const targetExists = await adapter.exists(targetPath)
    const targetIsMalformed =
      targetExists &&
      parseJsonRecord(
        await readBoundedTextFile(adapter, targetPath, readBudget),
        relativeDirectory(paths.canonicalJsonRoot, targetPath),
      ) === null
    if (!targetExists || targetIsMalformed) {
      await ensureFolderTree(adapter, parentPath(targetPath))
      await writeFileAtomically(adapter, targetPath, parsedRecord.content)
    } else {
      continue
    }
    for (const recordKey of parsedRecord.keys) {
      existingKeys.add(recordKey)
    }
  }

  if (skippedMalformedFiles > 0) {
    return failed(
      paths.legacyJsonRoot,
      paths.canonicalJsonRoot,
      `Skipped ${skippedMalformedFiles} malformed legacy JSON file(s)`,
    )
  }

  return completed(paths.legacyJsonRoot, paths.canonicalJsonRoot)
}

async function collectJsonRecordKeys(
  adapter: AiderAdoptionAdapter,
  rootDir: string,
  readBudget: AdoptionReadBudget,
): Promise<Set<JsonRecordKey>> {
  if (!(await adapter.exists(rootDir))) {
    return new Set()
  }

  const keys = new Set<JsonRecordKey>()
  const files = await listJsonFilesRecursively(adapter, rootDir)
  for (const filePath of files) {
    const parsedRecord = parseJsonRecord(
      await readBoundedTextFile(adapter, filePath, readBudget),
      relativeDirectory(rootDir, filePath),
    )
    if (parsedRecord !== null) {
      for (const key of parsedRecord.keys) {
        keys.add(key)
      }
    }
  }
  return keys
}

function parseJsonRecord(
  content: string,
  recordGroup: string,
): ParsedJsonRecord | null {
  const record = parseJsonObject(content)
  switch (recordGroup) {
    case CHAT_DIR: {
      const chat = normalizeChatConversation(record)
      return chat
        ? {
            content: isChatConversation(record)
              ? content
              : JSON.stringify(chat, null, 2),
            keys: [`${recordGroup}:id:${chat.id}`],
          }
        : null
    }
    case TEMPLATE_DIR:
      return isTemplate(record)
        ? {
            content,
            keys: [
              `${recordGroup}:id:${record.id}`,
              `${recordGroup}:name:${record.name}`,
            ],
          }
        : null
    default:
      return null
  }
}

function hasJsonRecordConflict(
  existingKeys: ReadonlySet<JsonRecordKey>,
  recordKeys: readonly JsonRecordKey[],
): boolean {
  return recordKeys.some((recordKey) => existingKeys.has(recordKey))
}

async function listJsonFilesRecursively(
  adapter: AiderAdoptionAdapter,
  rootDir: string,
  state: { entries: number; visited: Set<string> } = {
    entries: 0,
    visited: new Set(),
  },
  depth = 0,
): Promise<readonly string[]> {
  if (depth > MAX_ADOPTION_DIRECTORY_DEPTH) {
    throw new Error('Adoption directory depth exceeds the limit')
  }
  const normalizedRoot = normalizePath(rootDir)
  if (state.visited.has(normalizedRoot)) {
    throw new Error('Adoption directory cycle detected')
  }
  state.visited.add(normalizedRoot)
  const listed = await adapter.list(rootDir)
  state.entries += listed.files.length + listed.folders.length
  if (state.entries > MAX_ADOPTION_JSON_FILES) {
    throw new Error('Adoption directory entry count exceeds the limit')
  }
  const childFiles = listed.files.filter((filePath) =>
    filePath.endsWith('.json'),
  )
  const nestedFiles: string[] = []
  for (const folderPath of listed.folders) {
    nestedFiles.push(
      ...(await listJsonFilesRecursively(
        adapter,
        folderPath,
        state,
        depth + 1,
      )),
    )
  }

  return [...childFiles, ...nestedFiles]
}
