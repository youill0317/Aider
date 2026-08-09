import { DataAdapter, normalizePath } from 'obsidian'

type AtomicAdapter = Pick<
  DataAdapter,
  'exists' | 'remove' | 'rename' | 'write' | 'writeBinary'
>

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
): Promise<void> {
  const temporaryPath = temporarySiblingPath(filePath)
  // Obsidian's rename refuses an existing destination, so the original has to
  // move aside first. Keeping it as a backup means a failed rename can put it
  // straight back instead of leaving nothing behind.
  const backupPath = temporarySiblingPath(filePath)
  let backedUp = false
  try {
    await writeTemporaryFile(temporaryPath)
    if (await adapter.exists(filePath)) {
      await adapter.rename(filePath, backupPath)
      backedUp = true
    }
    await adapter.rename(temporaryPath, filePath)
  } catch (error) {
    if (backedUp && !(await adapter.exists(filePath))) {
      try {
        await adapter.rename(backupPath, filePath)
        backedUp = false
      } catch {
        // Leave the backup in place; it is the only remaining copy.
      }
    }
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath)
      }
    } catch {
      // Preserve the original write error; temporary-file cleanup is best effort.
    }
    throw error
  } finally {
    if (backedUp) {
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
  await replaceAtomically(adapter, filePath, (temporaryPath) =>
    adapter.write(temporaryPath, content),
  )
}

export async function writeBinaryFileAtomically(
  adapter: AtomicAdapter,
  filePath: string,
  content: ArrayBuffer,
): Promise<void> {
  await replaceAtomically(adapter, filePath, (temporaryPath) =>
    adapter.writeBinary(temporaryPath, content),
  )
}
