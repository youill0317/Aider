import { normalizePath } from 'obsidian'

import type { AiderAdoptionAdapter } from './aiderAdoptionTypes'

export const MAX_ADOPTION_JSON_FILE_BYTES = 64 * 1024 * 1024
const MAX_ADOPTION_TOTAL_JSON_BYTES = 512 * 1024 * 1024
export const MAX_ADOPTION_JSON_FILES = 10_000
export const MAX_ADOPTION_DIRECTORY_DEPTH = 32

export type AdoptionReadBudget = {
  filesRead: number
  bytesRead: number
}

export function createAdoptionReadBudget(): AdoptionReadBudget {
  return { filesRead: 0, bytesRead: 0 }
}

export async function readBoundedTextFile(
  adapter: AiderAdoptionAdapter,
  path: string,
  budget: AdoptionReadBudget,
  maxBytes = MAX_ADOPTION_JSON_FILE_BYTES,
): Promise<string> {
  if (budget.filesRead >= MAX_ADOPTION_JSON_FILES) {
    throw new Error('Adoption JSON file count exceeds the limit')
  }
  const stat = await adapter.stat(path)
  if (stat?.type === 'file' && stat.size > maxBytes) {
    throw new Error('Adoption JSON file is too large')
  }

  const content = await adapter.read(path)
  if (content.length > maxBytes) {
    throw new Error('Adoption JSON file is too large')
  }
  const contentBytes = new TextEncoder().encode(content).byteLength
  if (contentBytes > maxBytes) {
    throw new Error('Adoption JSON file is too large')
  }
  if (budget.bytesRead + contentBytes > MAX_ADOPTION_TOTAL_JSON_BYTES) {
    throw new Error('Adoption JSON data exceeds the total size limit')
  }
  budget.filesRead += 1
  budget.bytesRead += contentBytes
  return content
}

export function parseJsonObject(
  content: string,
): Record<string, unknown> | null {
  const value = parseJsonValue(content)
  if (isObject(value)) {
    return value
  }
  return null
}

export function parseJsonValue(content: string): unknown | null {
  try {
    const value: unknown = JSON.parse(content)
    return value
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export function hasObjectProperty<Key extends string>(
  value: unknown,
  key: Key,
): value is Record<Key, Record<string, unknown>> {
  return isObject(value) && isObject(value[key])
}

export function hasStringProperty<Key extends string>(
  value: unknown,
  key: Key,
): value is Record<Key, string> {
  return isObject(value) && typeof value[key] === 'string'
}

export function hasNumberProperty<Key extends string>(
  value: unknown,
  key: Key,
): value is Record<Key, number> {
  return isObject(value) && typeof value[key] === 'number'
}

export async function ensureFolderTree(
  adapter: AiderAdoptionAdapter,
  folderPath: string,
): Promise<void> {
  const parts = normalizePath(folderPath).split('/').filter(Boolean)
  let currentPath = ''

  for (const part of parts) {
    currentPath = currentPath === '' ? part : `${currentPath}/${part}`
    if (!(await adapter.exists(currentPath))) {
      await adapter.mkdir(currentPath)
    }
  }
}

export function relativePath(rootDir: string, filePath: string): string {
  const normalizedRootDir = normalizePath(rootDir)
  return normalizePath(filePath).slice(normalizedRootDir.length + 1)
}

export function relativeDirectory(rootDir: string, filePath: string): string {
  return parentPath(relativePath(rootDir, filePath))
}

export function parentPath(filePath: string): string {
  const normalizedPath = normalizePath(filePath)
  const slashIndex = normalizedPath.lastIndexOf('/')
  return slashIndex === -1 ? '' : normalizedPath.slice(0, slashIndex)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
