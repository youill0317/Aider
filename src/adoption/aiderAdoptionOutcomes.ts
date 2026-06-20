import type { AdoptionOutcome } from './aiderAdoptionTypes'

export function completed(
  sourcePath: string,
  targetPath: string,
): AdoptionOutcome {
  return { kind: 'completed', sourcePath, targetPath }
}

export function existing(
  sourcePath: string,
  targetPath: string,
): AdoptionOutcome {
  return { kind: 'skipped-existing-aider-data', sourcePath, targetPath }
}

export function missing(
  sourcePath: string,
  targetPath: string,
): AdoptionOutcome {
  return { kind: 'skipped-missing-legacy-data', sourcePath, targetPath }
}

export function failed(
  sourcePath: string,
  targetPath: string,
  error: string,
): AdoptionOutcome {
  return { kind: 'failed', sourcePath, targetPath, error }
}
