export const ADOPTION_MARKER_FILE = '.aider_adoption.json'
export const ADOPTION_RESOURCES = [
  'pluginData',
  'jsonDb',
  'vectorDb',
  'legacyChatHistories',
  'secrets',
] as const

export type AdoptionResource = (typeof ADOPTION_RESOURCES)[number]
export type AdoptionStatusKind =
  | 'completed'
  | 'failed'
  | 'skipped-existing-aider-data'
  | 'skipped-missing-legacy-data'

export type AdoptionResourceStatus = {
  readonly status: AdoptionStatusKind
  readonly sourcePath: string
  readonly targetPath: string
  readonly completedAt?: string
  readonly lastError?: string
}

export type AiderAdoptionMarker = {
  readonly resources: Partial<Record<AdoptionResource, AdoptionResourceStatus>>
}

export type AdapterList = {
  readonly files: readonly string[]
  readonly folders: readonly string[]
}

export type AiderAdoptionAdapter = {
  readonly exists: (path: string) => Promise<boolean>
  readonly mkdir: (path: string) => Promise<void>
  readonly read: (path: string) => Promise<string>
  readonly write: (path: string, content: string) => Promise<void>
  readonly readBinary: (path: string) => Promise<ArrayBuffer>
  readonly writeBinary: (path: string, content: ArrayBuffer) => Promise<void>
  readonly list: (path: string) => Promise<AdapterList>
}

export type AiderAdoptionApp = {
  readonly vault: {
    readonly configDir: string
    readonly adapter: AiderAdoptionAdapter
  }
}

export type AdoptionPaths = {
  readonly markerPath: string
  readonly canonicalPluginDataPath: string
  readonly legacyPluginDataPath: string
  readonly canonicalJsonRoot: string
  readonly legacyJsonRoot: string
  readonly canonicalVectorPath: string
  readonly legacyVectorPath: string
  readonly canonicalChatHistoryDir: string
  readonly legacyChatHistoryDir: string
}

export type AdoptionOutcome =
  | {
      readonly kind:
        | 'completed'
        | 'skipped-existing-aider-data'
        | 'skipped-missing-legacy-data'
      readonly sourcePath: string
      readonly targetPath: string
    }
  | {
      readonly kind: 'failed'
      readonly sourcePath: string
      readonly targetPath: string
      readonly error: string
    }

export function isTerminalAdoptionStatus(
  status: AdoptionStatusKind | undefined,
): boolean {
  return (
    status === 'completed' ||
    status === 'skipped-existing-aider-data' ||
    status === 'skipped-missing-legacy-data'
  )
}

export function isAdoptionStatusKind(
  value: string,
): value is AdoptionStatusKind {
  switch (value) {
    case 'completed':
    case 'failed':
    case 'skipped-existing-aider-data':
    case 'skipped-missing-legacy-data':
      return true
  }
  return false
}
