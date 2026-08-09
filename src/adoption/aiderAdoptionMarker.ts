import { normalizePath } from 'obsidian'

import { LEGACY_PGLITE_DB_PATH, PGLITE_DB_PATH } from '../constants'
import { LEGACY_ROOT_DIR, ROOT_DIR } from '../database/json/constants'
import { writeFileAtomically } from '../utils/atomic-file'
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
  createAdoptionReadBudget,
  ensureFolderTree,
  hasObjectProperty,
  hasStringProperty,
  parentPath,
  parseJsonObject,
  readBoundedTextFile,
} from './aiderAdoptionUtils'

const MAX_ADOPTION_MARKER_BYTES = 1024 * 1024

export async function readAdoptionMarker(
  app: AiderAdoptionApp,
  markerPath: string,
): Promise<AiderAdoptionMarker> {
  if (!(await app.vault.adapter.exists(markerPath))) {
    return { resources: {} }
  }

  const marker = parseAdoptionMarker(
    await readBoundedTextFile(
      app.vault.adapter,
      markerPath,
      createAdoptionReadBudget(),
      MAX_ADOPTION_MARKER_BYTES,
    ),
  )
  return {
    resources: await pruneMissingRecoveryPaths(
      app.vault.adapter,
      marker.resources,
    ),
  }
}

// A recovery backup the user already moved or deleted must stop being reported,
// or the startup notice never goes away.
async function pruneMissingRecoveryPaths(
  adapter: AiderAdoptionApp['vault']['adapter'],
  resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>>,
): Promise<Partial<Record<AdoptionResource, AdoptionResourceStatus>>> {
  const pruned = { ...resources }
  for (const resource of ADOPTION_RESOURCES) {
    const status = pruned[resource]
    if (!status?.recoveryPaths?.length) continue
    const remaining: string[] = []
    for (const path of status.recoveryPaths) {
      // An unreadable adapter counts as present; a transient error must not
      // drop the last pointer to the only surviving copy.
      if (await adapter.exists(path).catch(() => true)) {
        remaining.push(path)
      }
    }
    if (remaining.length === status.recoveryPaths.length) continue
    const next = { ...status }
    if (remaining.length) {
      next.recoveryPaths = remaining
    } else {
      delete next.recoveryPaths
    }
    pruned[resource] = next
  }
  return pruned
}

export async function writeUpdatedMarker(
  app: AiderAdoptionApp,
  markerPath: string,
  resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>>,
): Promise<Partial<Record<AdoptionResource, AdoptionResourceStatus>>> {
  await ensureFolderTree(app.vault.adapter, parentPath(markerPath))
  await writeFileAtomically(
    app.vault.adapter,
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

  const resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>> =
    {}
  for (const resource of ADOPTION_RESOURCES) {
    const status = parseAdoptionResourceStatus(value.resources[resource])
    if (status !== null) {
      resources[resource] = status
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
  const storedRecoveryPaths = (value as Record<string, unknown>).recoveryPaths
  const recoveryPaths = Array.from(
    new Set<string>(
      Array.isArray(storedRecoveryPaths) &&
      storedRecoveryPaths.every((path) => typeof path === 'string')
        ? storedRecoveryPaths
        : [],
    ),
  )
  if (value.status === 'failed') {
    return {
      status: value.status,
      sourcePath: value.sourcePath,
      targetPath: value.targetPath,
      completedAt,
      ...(hasStringProperty(value, 'lastError')
        ? { lastError: value.lastError }
        : {}),
      ...(recoveryPaths.length ? { recoveryPaths } : {}),
    }
  }
  return {
    status: value.status,
    sourcePath: value.sourcePath,
    targetPath: value.targetPath,
    completedAt,
    ...(recoveryPaths.length ? { recoveryPaths } : {}),
  }
}
