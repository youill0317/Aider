import { completed, existing, failed, missing } from './aiderAdoptionOutcomes'
import type {
  AdoptionOutcome,
  AdoptionPaths,
  AiderAdoptionApp,
} from './aiderAdoptionTypes'
import {
  ensureFolderTree,
  parentPath,
  parseJsonValue,
} from './aiderAdoptionUtils'

export { adoptChatHistories } from './aiderChatHistoryAdoption'
export { adoptJsonDatabase } from './aiderJsonDatabaseAdoption'

export async function adoptPluginData(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
): Promise<AdoptionOutcome> {
  const adapter = app.vault.adapter
  if (await adapter.exists(paths.canonicalPluginDataPath)) {
    return existing(paths.legacyPluginDataPath, paths.canonicalPluginDataPath)
  }
  if (!(await adapter.exists(paths.legacyPluginDataPath))) {
    return missing(paths.legacyPluginDataPath, paths.canonicalPluginDataPath)
  }

  const content = await adapter.read(paths.legacyPluginDataPath)
  if (parseJsonValue(content) === null) {
    return failed(
      paths.legacyPluginDataPath,
      paths.canonicalPluginDataPath,
      'Legacy plugin data is malformed JSON',
    )
  }

  await ensureFolderTree(adapter, parentPath(paths.canonicalPluginDataPath))
  await adapter.write(paths.canonicalPluginDataPath, content)
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

  await adapter.writeBinary(
    paths.canonicalVectorPath,
    await adapter.readBinary(paths.legacyVectorPath),
  )
  return completed(paths.legacyVectorPath, paths.canonicalVectorPath)
}

export function adoptSecretNamespace(): Promise<AdoptionOutcome> {
  return Promise.resolve(
    completed('smart-composer-provider-*', 'aider-provider-*'),
  )
}
