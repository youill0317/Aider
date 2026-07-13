export type LineVectorMetaData = {
  linkMode?: 'line'
  startLine: number
  endLine: number
  indexProfile?: string
}

export type FileOnlyVectorMetaData = {
  linkMode: 'file-only'
  source: 'voyage-auto-chunk'
  chunkerVersion?: string
  chunkSizeMode: 'server-default'
  indexProfile: string
}

export type VectorMetaData = LineVectorMetaData | FileOnlyVectorMetaData

export type VectorLineRange = {
  startLine: number
  endLine: number
}

export function hasExactLineMetadata(
  metadata: unknown,
): metadata is LineVectorMetaData {
  return getVectorLineRange(metadata) !== null
}

export function getVectorLineRange(metadata: unknown): VectorLineRange | null {
  if (!isRecord(metadata)) {
    return null
  }

  const { startLine, endLine } = metadata
  if (!isPositiveInteger(startLine) || !isPositiveInteger(endLine)) {
    return null
  }
  if (endLine < startLine) {
    return null
  }

  return { startLine, endLine }
}

export function createVoyageContextualMetadata({
  chunkerVersion,
  embeddingProfile,
}: {
  chunkerVersion?: string
  embeddingProfile: string
}): FileOnlyVectorMetaData {
  return {
    linkMode: 'file-only',
    source: 'voyage-auto-chunk',
    ...(chunkerVersion ? { chunkerVersion } : {}),
    chunkSizeMode: 'server-default',
    indexProfile: getVoyageContextualIndexProfile(embeddingProfile),
  }
}

export function hasMatchingVoyageContextualIndexProfile({
  embeddingProfile,
  metadata,
}: {
  embeddingProfile: string
  metadata: unknown
}): boolean {
  if (!isRecord(metadata)) {
    return false
  }
  return (
    metadata.linkMode === 'file-only' &&
    metadata.source === 'voyage-auto-chunk' &&
    metadata.chunkSizeMode === 'server-default' &&
    metadata.indexProfile === getVoyageContextualIndexProfile(embeddingProfile)
  )
}

export function getVoyageContextualIndexProfile(
  embeddingProfile: string,
): string {
  return JSON.stringify([
    'voyage-contextual-v2',
    'route=voyage-contextual-auto-chunk',
    'endpoint=contextualizedembeddings',
    'autoChunking=true',
    'chunkSizeMode=server-default',
    embeddingProfile,
  ])
}

export function getStandardIndexProfile({
  chunkSize,
  embeddingProfile,
}: {
  chunkSize: number
  embeddingProfile: string
}): string {
  return JSON.stringify(['standard-v1', embeddingProfile, chunkSize])
}

export function hasMatchingStandardIndexProfile({
  indexProfile,
  metadata,
}: {
  indexProfile: string
  metadata: unknown
}): boolean {
  return isRecord(metadata) && metadata.indexProfile === indexProfile
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
