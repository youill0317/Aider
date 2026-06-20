import {
  buildAdoptionPaths,
  readAdoptionMarker,
  writeUpdatedMarker,
} from './aiderAdoptionMarker'
import {
  type AdoptionOutcome,
  type AdoptionPaths,
  type AdoptionResource,
  type AdoptionResourceStatus,
  type AiderAdoptionApp,
  type AiderAdoptionMarker,
  isTerminalAdoptionStatus,
} from './aiderAdoptionTypes'
import {
  adoptChatHistories,
  adoptJsonDatabase,
  adoptPluginData,
  adoptSecretNamespace,
  adoptVectorDatabase,
} from './aiderStorageResources'

export const REDACTED_ADOPTION_ERROR =
  'Adoption failed; details redacted to avoid exposing secrets or vault content'

export async function adoptAiderStorage(
  app: AiderAdoptionApp,
): Promise<AiderAdoptionMarker> {
  const paths = buildAdoptionPaths(app)
  const marker = await readAdoptionMarker(app, paths.markerPath)
  let nextResources = marker.resources

  nextResources = await adoptResource(
    app,
    paths,
    nextResources,
    'pluginData',
    () => adoptPluginData(app, paths),
  )
  nextResources = await adoptResource(app, paths, nextResources, 'jsonDb', () =>
    adoptJsonDatabase(app, paths),
  )
  nextResources = await adoptResource(
    app,
    paths,
    nextResources,
    'vectorDb',
    () => adoptVectorDatabase(app, paths),
  )
  nextResources = await adoptResource(
    app,
    paths,
    nextResources,
    'legacyChatHistories',
    () => adoptChatHistories(app, paths),
  )
  nextResources = await adoptResource(
    app,
    paths,
    nextResources,
    'secrets',
    () => adoptSecretNamespace(),
  )

  return { resources: nextResources }
}

async function adoptResource(
  app: AiderAdoptionApp,
  paths: AdoptionPaths,
  resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>>,
  resource: AdoptionResource,
  adopt: () => Promise<AdoptionOutcome>,
): Promise<Partial<Record<AdoptionResource, AdoptionResourceStatus>>> {
  if (isTerminalAdoptionStatus(resources[resource]?.status)) {
    return resources
  }

  const outcome = await adopt().catch((error: unknown): AdoptionOutcome => {
    const { sourcePath, targetPath } = getResourcePaths(paths, resource)
    return {
      kind: 'failed',
      sourcePath,
      targetPath,
      error: summarizeAdoptionError(error),
    }
  })
  const completedAt = new Date().toISOString()

  switch (outcome.kind) {
    case 'completed':
    case 'skipped-existing-aider-data':
    case 'skipped-missing-legacy-data':
      return writeUpdatedMarker(app, paths.markerPath, {
        ...resources,
        [resource]: {
          status: outcome.kind,
          sourcePath: outcome.sourcePath,
          targetPath: outcome.targetPath,
          completedAt,
        },
      })
    case 'failed':
      return writeUpdatedMarker(app, paths.markerPath, {
        ...resources,
        [resource]: {
          status: 'failed',
          sourcePath: outcome.sourcePath,
          targetPath: outcome.targetPath,
          completedAt,
          lastError: outcome.error,
        },
      })
  }
}

function getResourcePaths(
  paths: AdoptionPaths,
  resource: AdoptionResource,
): Pick<AdoptionOutcome, 'sourcePath' | 'targetPath'> {
  switch (resource) {
    case 'pluginData':
      return {
        sourcePath: paths.legacyPluginDataPath,
        targetPath: paths.canonicalPluginDataPath,
      }
    case 'jsonDb':
      return {
        sourcePath: paths.legacyJsonRoot,
        targetPath: paths.canonicalJsonRoot,
      }
    case 'vectorDb':
      return {
        sourcePath: paths.legacyVectorPath,
        targetPath: paths.canonicalVectorPath,
      }
    case 'legacyChatHistories':
      return {
        sourcePath: paths.legacyChatHistoryDir,
        targetPath: paths.canonicalChatHistoryDir,
      }
    case 'secrets':
      return {
        sourcePath: 'smart-composer-provider-*',
        targetPath: 'aider-provider-*',
      }
  }
}

export function summarizeAdoptionError(_error: unknown): string {
  return REDACTED_ADOPTION_ERROR
}
