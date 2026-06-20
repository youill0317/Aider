import { normalizePath } from 'obsidian'

import { LEGACY_PGLITE_DB_PATH, PGLITE_DB_PATH } from '../constants'
import { LEGACY_ROOT_DIR, ROOT_DIR } from '../database/json/constants'
import {
  CHAT_HISTORY_DIR,
  LEGACY_CHAT_HISTORY_DIR,
} from '../utils/chat/chatHistoryManager'

import {
  ADOPTION_MARKER_FILE,
  ADOPTION_RESOURCES,
  type AdoptionPaths,
  type AdoptionResource,
  type AdoptionResourceStatus,
  type AiderAdoptionApp,
  type AiderAdoptionMarker,
  isAdoptionStatusKind,
} from './aiderAdoptionTypes'
import {
  ensureFolderTree,
  hasObjectProperty,
  hasStringProperty,
  parentPath,
  parseJsonObject,
} from './aiderAdoptionUtils'

export async function readAdoptionMarker(
  app: AiderAdoptionApp,
  markerPath: string,
): Promise<AiderAdoptionMarker> {
  if (!(await app.vault.adapter.exists(markerPath))) {
    return { resources: {} }
  }

  return parseAdoptionMarker(await app.vault.adapter.read(markerPath))
}

export async function writeUpdatedMarker(
  app: AiderAdoptionApp,
  markerPath: string,
  resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>>,
): Promise<Partial<Record<AdoptionResource, AdoptionResourceStatus>>> {
  await ensureFolderTree(app.vault.adapter, parentPath(markerPath))
  await app.vault.adapter.write(
    markerPath,
    JSON.stringify({ resources }, null, 2),
  )
  return resources
}

export function buildAdoptionPaths(app: AiderAdoptionApp): AdoptionPaths {
  return {
    markerPath: normalizePath(
      `${app.vault.configDir}/plugins/aider/${ADOPTION_MARKER_FILE}`,
    ),
    canonicalPluginDataPath: normalizePath(
      `${app.vault.configDir}/plugins/aider/data.json`,
    ),
    legacyPluginDataPath: normalizePath(
      `${app.vault.configDir}/plugins/smart-composer/data.json`,
    ),
    canonicalJsonRoot: normalizePath(ROOT_DIR),
    legacyJsonRoot: normalizePath(LEGACY_ROOT_DIR),
    canonicalVectorPath: normalizePath(PGLITE_DB_PATH),
    legacyVectorPath: normalizePath(LEGACY_PGLITE_DB_PATH),
    canonicalChatHistoryDir: normalizePath(CHAT_HISTORY_DIR),
    legacyChatHistoryDir: normalizePath(LEGACY_CHAT_HISTORY_DIR),
  }
}

function parseAdoptionMarker(content: string): AiderAdoptionMarker {
  const value = parseJsonObject(content)
  if (!hasObjectProperty(value, 'resources')) {
    return { resources: {} }
  }

  let resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>> = {}
  for (const resource of ADOPTION_RESOURCES) {
    const status = parseAdoptionResourceStatus(value.resources[resource])
    if (status !== null) {
      resources = { ...resources, [resource]: status }
    }
  }
  return { resources }
}

function parseAdoptionResourceStatus(
  value: unknown,
): AdoptionResourceStatus | null {
  if (
    !hasStringProperty(value, 'status') ||
    !hasStringProperty(value, 'sourcePath') ||
    !hasStringProperty(value, 'targetPath') ||
    !isAdoptionStatusKind(value.status)
  ) {
    return null
  }

  const completedAt = hasStringProperty(value, 'completedAt')
    ? value.completedAt
    : undefined
  if (value.status === 'failed' && hasStringProperty(value, 'lastError')) {
    return {
      status: value.status,
      sourcePath: value.sourcePath,
      targetPath: value.targetPath,
      completedAt,
      lastError: value.lastError,
    }
  }
  return {
    status: value.status,
    sourcePath: value.sourcePath,
    targetPath: value.targetPath,
    completedAt,
  }
}
