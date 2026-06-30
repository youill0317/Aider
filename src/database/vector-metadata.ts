export type LineVectorMetaData = {
  linkMode?: 'line'
  startLine: number
  endLine: number
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
  dimension,
  modelId,
}: {
  chunkerVersion?: string
  dimension: number
  modelId: string
}): FileOnlyVectorMetaData {
  return {
    linkMode: 'file-only',
    source: 'voyage-auto-chunk',
    ...(chunkerVersion ? { chunkerVersion } : {}),
    chunkSizeMode: 'server-default',
    indexProfile: getVoyageContextualIndexProfile({ dimension, modelId }),
  }
}

export function hasMatchingVoyageContextualIndexProfile({
  dimension,
  metadata,
  modelId,
}: {
  dimension: number
  metadata: unknown
  modelId: string
}): boolean {
  if (!isRecord(metadata)) {
    return false
  }
  return (
    metadata.linkMode === 'file-only' &&
    metadata.source === 'voyage-auto-chunk' &&
    metadata.chunkSizeMode === 'server-default' &&
    metadata.indexProfile ===
      getVoyageContextualIndexProfile({ dimension, modelId })
  )
}

export function getVoyageContextualIndexProfile({
  dimension,
  modelId,
}: {
  dimension: number
  modelId: string
}): string {
  return [
    'route=voyage-contextual-auto-chunk',
    'endpoint=contextualizedembeddings',
    `model=${modelId}`,
    `dimension=${dimension}`,
    'autoChunking=true',
    'chunkSizeMode=server-default',
  ].join(';')
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
