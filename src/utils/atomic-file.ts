import { DataAdapter, normalizePath } from 'obsidian'

type AtomicAdapter = Pick<
  DataAdapter,
  | 'exists'
  | 'read'
  | 'readBinary'
  | 'remove'
  | 'rename'
  | 'write'
  | 'writeBinary'
>

export class AtomicWriteRecoveryError extends Error {
  constructor(
    readonly backupPath: string,
    readonly replacementError: unknown,
    readonly restoreError: unknown,
    readonly additionalBackupPaths: readonly string[] = [],
  ) {
    super(
      `Atomic write failed (${String(replacementError)}); restore failed (${String(restoreError)}); original data remains at ${[backupPath, ...additionalBackupPaths].map((path) => `"${path}"`).join(', ')}`,
    )
    this.name = 'AtomicWriteRecoveryError'
  }

  get backupPaths(): readonly string[] {
    return [this.backupPath, ...this.additionalBackupPaths]
  }

  // Every user-facing message goes through this, so a second backup can never
  // be silently dropped by a caller reading backupPath alone.
  get backupPathList(): string {
    return this.backupPaths.map((path) => `"${path}"`).join(', ')
  }
}

function temporarySiblingPath(filePath: string): string {
  const normalizedPath = normalizePath(filePath)
  const slashIndex = normalizedPath.lastIndexOf('/')
  const directory =
    slashIndex === -1 ? '' : normalizedPath.slice(0, slashIndex + 1)
  return normalizePath(
    `${directory}.aider-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  )
}

async function replaceAtomically(
  adapter: AtomicAdapter,
  filePath: string,
  writeTemporaryFile: (temporaryPath: string) => Promise<void>,
  restoreBackup: (backupPath: string) => Promise<void>,
): Promise<void> {
  const temporaryPath = temporarySiblingPath(filePath)
  // Obsidian's rename refuses an existing destination, so the original has to
  // move aside first. Keeping it as a backup means a failed rename can put it
  // straight back instead of leaving nothing behind.
  const backupPath = temporarySiblingPath(filePath)
  let backedUp = false
  let replacementInstalled = false
  let unrecoveredBackupPath: string | null = null
  let unrecoveredRestoreError: unknown = null
  try {
    await writeTemporaryFile(temporaryPath)
    if (await adapter.exists(filePath)) {
      await adapter.rename(filePath, backupPath)
      backedUp = true
    }
    await adapter.rename(temporaryPath, filePath)
    replacementInstalled = true
  } catch (error) {
    if (backedUp) {
      let targetExists = true
      try {
        targetExists = await adapter.exists(filePath)
      } catch (restoreError) {
        unrecoveredBackupPath = backupPath
        unrecoveredRestoreError = restoreError
      }
      if (targetExists && !unrecoveredBackupPath) {
        unrecoveredBackupPath = backupPath
        unrecoveredRestoreError = new Error(
          'Restore skipped because another writer created the target',
        )
      } else if (!targetExists) {
        try {
          await adapter.rename(backupPath, filePath)
          backedUp = false
        } catch {
          // Another writer can create the target between the check above and
          // this rename; copying the backup over it would clobber them. An
          // unreadable adapter counts as occupied - keeping the backup is the
          // safe direction.
          if (await adapter.exists(filePath).catch(() => true)) {
            unrecoveredBackupPath = backupPath
            unrecoveredRestoreError = new Error(
              'Restore skipped because another writer created the target',
            )
          } else {
            try {
              await restoreBackup(backupPath)
              backedUp = false
              try {
                await adapter.remove(backupPath)
              } catch {
                // The original path is restored; stale-backup cleanup is best effort.
              }
            } catch (restoreError) {
              unrecoveredBackupPath = backupPath
              unrecoveredRestoreError = restoreError
            }
          }
        }
      }
    }
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath)
      }
    } catch {
      // Preserve the original write error; temporary-file cleanup is best effort.
    }
    if (unrecoveredBackupPath) {
      throw new AtomicWriteRecoveryError(
        unrecoveredBackupPath,
        error,
        unrecoveredRestoreError,
      )
    }
    throw error
  } finally {
    if (backedUp && replacementInstalled) {
      try {
        await adapter.remove(backupPath)
      } catch {
        // The replacement already succeeded; a stale backup is harmless.
      }
    }
  }
}

export async function writeFileAtomically(
  adapter: AtomicAdapter,
  filePath: string,
  content: string,
): Promise<void> {
  await replaceAtomically(
    adapter,
    filePath,
    (temporaryPath) => adapter.write(temporaryPath, content),
    async (backupPath) =>
      adapter.write(filePath, await adapter.read(backupPath)),
  )
}

export async function writeBinaryFileAtomically(
  adapter: AtomicAdapter,
  filePath: string,
  content: ArrayBuffer,
): Promise<void> {
  await replaceAtomically(
    adapter,
    filePath,
    (temporaryPath) => adapter.writeBinary(temporaryPath, content),
    async (backupPath) =>
      adapter.writeBinary(filePath, await adapter.readBinary(backupPath)),
  )
}
