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
  try {
    await writeTemporaryFile(temporaryPath)
    await adapter.rename(temporaryPath, filePath)
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath)
      }
    } catch {
      // Preserve the original write error; temporary-file cleanup is best effort.
    }
    throw error
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
