import { MAX_PGLITE_DATABASE_BYTES } from '../constants'
import {
  writeBinaryFileAtomically,
  writeFileAtomically,
} from '../utils/atomic-file'

import { completed, existing, failed, missing } from './aiderAdoptionOutcomes'
import type {
  AdoptionOutcome,
  AdoptionPaths,
  AiderAdoptionApp,
} from './aiderAdoptionTypes'
import {
  createAdoptionReadBudget,
  ensureFolderTree,
  parentPath,
  parseJsonObject,
  readBoundedTextFile,
} from './aiderAdoptionUtils'

export { adoptChatHistories } from './aiderChatHistoryAdoption'
export { adoptJsonDatabase } from './aiderJsonDatabaseAdoption'

export async function adoptPluginData(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  const readBudget = createAdoptionReadBudget()
  if (await adapter.exists(paths.canonicalPluginDataPath)) {
    const canonicalContent = await readBoundedTextFile(
      adapter,
      paths.canonicalPluginDataPath,
      readBudget,
    )
    if (parseJsonObject(canonicalContent) !== null) {
      return existing(paths.legacyPluginDataPath, paths.canonicalPluginDataPath)
    }
  }
  if (!(await adapter.exists(paths.legacyPluginDataPath))) {
    return missing(paths.legacyPluginDataPath, paths.canonicalPluginDataPath)
  }

  const content = await readBoundedTextFile(
    adapter,
    paths.legacyPluginDataPath,
    readBudget,
  )
  if (parseJsonObject(content) === null) {
    return failed(
      paths.legacyPluginDataPath,
      paths.canonicalPluginDataPath,
      'Legacy plugin data is malformed JSON',
    )
  }

  await ensureFolderTree(adapter, parentPath(paths.canonicalPluginDataPath))
  await writeFileAtomically(adapter, paths.canonicalPluginDataPath, content)
  return completed(paths.legacyPluginDataPath, paths.canonicalPluginDataPath)
}

export async function adoptVectorDatabase(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  if (await adapter.exists(paths.canonicalVectorPath)) {
    return existing(paths.legacyVectorPath, paths.canonicalVectorPath)
  }
  if (!(await adapter.exists(paths.legacyVectorPath))) {
    return missing(paths.legacyVectorPath, paths.canonicalVectorPath)
  }

  const legacyStat = await adapter.stat(paths.legacyVectorPath)
  if (
    legacyStat?.type === 'file' &&
    legacyStat.size > MAX_PGLITE_DATABASE_BYTES
  ) {
    return failed(
      paths.legacyVectorPath,
      paths.canonicalVectorPath,
      'Legacy vector database archive is too large',
    )
  }

  const legacyDatabase = await adapter.readBinary(paths.legacyVectorPath)
  if (legacyDatabase.byteLength > MAX_PGLITE_DATABASE_BYTES) {
    return failed(
      paths.legacyVectorPath,
      paths.canonicalVectorPath,
      'Legacy vector database archive is too large',
    )
  }

  await writeBinaryFileAtomically(
    adapter,
    paths.canonicalVectorPath,
    legacyDatabase,
  )
  return completed(paths.legacyVectorPath, paths.canonicalVectorPath)
}
