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
  hasStringProperty,
  parentPath,
  parseJsonObject,
  relativeDirectory,
  relativePath,
} from './aiderAdoptionUtils'

type JsonRecordConflictField = 'id' | 'name'
type JsonRecordKey = `${string}:${JsonRecordConflictField}:${string}`

export async function adoptJsonDatabase(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  if (!(await adapter.exists(paths.legacyJsonRoot))) {
    return missing(paths.legacyJsonRoot, paths.canonicalJsonRoot)
  }

  await ensureFolderTree(adapter, paths.canonicalJsonRoot)
  const existingKeys = await collectJsonRecordKeys(
    adapter,
    paths.canonicalJsonRoot,
  )
  const legacyFiles = [
    ...(await listJsonFilesRecursively(adapter, paths.legacyJsonRoot)),
  ].sort()
  let skippedMalformedFiles = 0

  for (const legacyFile of legacyFiles) {
    const content = await adapter.read(legacyFile)
    const recordKeys = parseJsonRecordKeys(
      content,
      relativeDirectory(paths.legacyJsonRoot, legacyFile),
    )

    if (recordKeys === null) {
      skippedMalformedFiles += 1
      continue
    }
    if (hasJsonRecordConflict(existingKeys, recordKeys)) {
      continue
    }

    const targetPath = normalizePath(
      `${paths.canonicalJsonRoot}/${relativePath(paths.legacyJsonRoot, legacyFile)}`,
    )
    if (!(await adapter.exists(targetPath))) {
      await ensureFolderTree(adapter, parentPath(targetPath))
      await adapter.write(targetPath, content)
    }
    for (const recordKey of recordKeys) {
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
): Promise<Set<JsonRecordKey>> {
  if (!(await adapter.exists(rootDir))) {
    return new Set()
  }

  const keys = new Set<JsonRecordKey>()
  const files = await listJsonFilesRecursively(adapter, rootDir)
  for (const filePath of files) {
    const recordKeys = parseJsonRecordKeys(
      await adapter.read(filePath),
      relativeDirectory(rootDir, filePath),
    )
    if (recordKeys !== null) {
      for (const key of recordKeys) {
        keys.add(key)
      }
    }
  }
  return keys
}

function parseJsonRecordKeys(
  content: string,
  recordGroup: string,
): readonly JsonRecordKey[] | null {
  const record = parseJsonObject(content)
  if (!hasStringProperty(record, 'id')) {
    return null
  }
  const keys: JsonRecordKey[] = [`${recordGroup}:id:${record.id}`]
  if (recordGroup === 'templates' && hasStringProperty(record, 'name')) {
    keys.push(`${recordGroup}:name:${record.name}`)
  }
  return keys
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
): Promise<readonly string[]> {
  const listed = await adapter.list(rootDir)
  const childFiles = listed.files.filter((filePath) =>
    filePath.endsWith('.json'),
  )
  const nestedFiles = await Promise.all(
    listed.folders.map((folderPath) =>
      listJsonFilesRecursively(adapter, folderPath),
    ),
  )

  return [...childFiles, ...nestedFiles.flat()]
}
