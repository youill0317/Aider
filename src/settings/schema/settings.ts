import { SETTINGS_SCHEMA_VERSION, SETTING_MIGRATIONS } from './migrations'
import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './setting.types'

export type SmartComposerSettingsParseResult = {
  settings: SmartComposerSettings
  safeToPersist: boolean
}

function asSettingsRecord(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) {
    return {}
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Settings must be an object')
  }
  return data as Record<string, unknown>
}

function preservesStoredValues(stored: unknown, parsed: unknown): boolean {
  if (Array.isArray(stored)) {
    return (
      Array.isArray(parsed) &&
      stored.length === parsed.length &&
      stored.every((value, index) =>
        preservesStoredValues(value, parsed[index]),
      )
    )
  }
  if (stored !== null && typeof stored === 'object') {
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return false
    }
    return Object.entries(stored).every(
      ([key, value]) =>
        key in parsed &&
        preservesStoredValues(value, (parsed as Record<string, unknown>)[key]),
    )
  }
  return Object.is(stored, parsed)
}

function migrateSettings(
  data: Record<string, unknown>,
): Record<string, unknown> {
  let currentData = { ...data }
  const storedVersion = currentData.version
  if (
    storedVersion !== undefined &&
    (typeof storedVersion !== 'number' ||
      !Number.isSafeInteger(storedVersion) ||
      storedVersion < 0 ||
      storedVersion > SETTINGS_SCHEMA_VERSION)
  ) {
    throw new Error('Unsupported settings version')
  }
  let currentVersion = storedVersion ?? 0

  for (const migration of SETTING_MIGRATIONS) {
    if (
      currentVersion >= migration.fromVersion &&
      currentVersion < migration.toVersion &&
      migration.toVersion <= SETTINGS_SCHEMA_VERSION
    ) {
      console.log(
        `Migrating settings from ${migration.fromVersion} to ${migration.toVersion}`,
      )
      currentData = migration.migrate(currentData)
      currentVersion = migration.toVersion
    }
  }

  if (currentVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new Error('Settings migration did not reach the current version')
  }

  return currentData
}

export function parseSmartComposerSettingsResult(
  data: unknown,
): SmartComposerSettingsParseResult {
  try {
    const settingsData = asSettingsRecord(data)
    const migratedData =
      Object.keys(settingsData).length === 0
        ? settingsData
        : migrateSettings(settingsData)
    const settings = smartComposerSettingsSchema.parse(migratedData)
    return {
      settings,
      safeToPersist: preservesStoredValues(migratedData, settings),
    }
  } catch (error) {
    console.warn('Invalid settings provided, using defaults:', error)
    return {
      settings: smartComposerSettingsSchema.parse({}),
      safeToPersist: false,
    }
  }
}

export function parseSmartComposerSettings(
  data: unknown,
): SmartComposerSettings {
  return parseSmartComposerSettingsResult(data).settings
}
