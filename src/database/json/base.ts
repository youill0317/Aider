import { App, DataAdapter, normalizePath } from 'obsidian'
import * as path from 'path-browserify'

// ponytail: JSON.parse is all-at-once; replace it before supporting files over 128 MiB.
const MAX_JSON_FILE_BYTES = 128 * 1024 * 1024

function isJsonFileTooLarge(content: string): boolean {
  return new Blob([content]).size > MAX_JSON_FILE_BYTES
}

export async function writeFileAtomically(
  adapter: DataAdapter,
  filePath: string,
  content: string,
): Promise<void> {
  const temporaryPath = normalizePath(
    `${filePath}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    await adapter.write(temporaryPath, content)
    await adapter.rename(temporaryPath, filePath)
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath)
      }
    } catch {
      // Keep the original write error; temporary-file cleanup is best effort.
    }
    throw error
  }
}

export abstract class AbstractJsonRepository<T, M> {
  protected dataDir: string
  protected app: App
  private directoryReady: Promise<void>

  constructor(app: App, dataDir: string) {
    this.app = app
    this.dataDir = normalizePath(dataDir)
    this.directoryReady = this.ensureDirectory()
  }

  private async ensureDirectory(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.dataDir))) {
      try {
        await this.app.vault.adapter.mkdir(this.dataDir)
      } catch (error) {
        if (!(await this.app.vault.adapter.exists(this.dataDir))) {
          throw error
        }
      }
    }
  }

  // Each subclass implements how to generate a file name from a data row.
  protected abstract generateFileName(row: T): string

  // Each subclass implements how to parse a file name into metadata.
  protected abstract parseFileName(fileName: string): M | null

  // Each subclass validates untrusted JSON before it reaches application code.
  protected abstract isValidRow(row: unknown): row is T

  private getFilePath(fileName: string): string {
    if (
      !fileName ||
      fileName !== path.basename(fileName) ||
      fileName.includes('\\')
    ) {
      throw new Error(`Invalid database file name: ${fileName}`)
    }
    return normalizePath(path.join(this.dataDir, fileName))
  }

  public async create(row: T): Promise<void> {
    await this.directoryReady
    const fileName = this.generateFileName(row)
    const filePath = this.getFilePath(fileName)
    const content = JSON.stringify(row, null, 2)
    if (isJsonFileTooLarge(content)) {
      throw new Error('JSON database record is too large')
    }

    if (await this.app.vault.adapter.exists(filePath)) {
      throw new Error(`File already exists: ${filePath}`)
    }

    await writeFileAtomically(this.app.vault.adapter, filePath, content)
  }

  public async update(oldRow: T, newRow: T): Promise<void> {
    await this.directoryReady
    const oldFileName = this.generateFileName(oldRow)
    const newFileName = this.generateFileName(newRow)
    const content = JSON.stringify(newRow, null, 2)
    if (isJsonFileTooLarge(content)) {
      throw new Error('JSON database record is too large')
    }

    if (oldFileName === newFileName) {
      // Simple update - filename hasn't changed
      const filePath = this.getFilePath(oldFileName)
      await writeFileAtomically(this.app.vault.adapter, filePath, content)
    } else {
      // Filename has changed - create new file and delete old one
      const newFilePath = this.getFilePath(newFileName)
      if (await this.app.vault.adapter.exists(newFilePath)) {
        throw new Error(`File already exists: ${newFilePath}`)
      }
      await writeFileAtomically(this.app.vault.adapter, newFilePath, content)
      await this.delete(oldFileName)
    }
  }

  // List metadata for all records by parsing file names.
  public async listMetadata(): Promise<(M & { fileName: string })[]> {
    await this.directoryReady
    const files = await this.app.vault.adapter.list(this.dataDir)
    return files.files
      .map((filePath) => path.basename(filePath))
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        try {
          const metadata = this.parseFileName(fileName)
          return metadata ? { ...metadata, fileName } : null
        } catch {
          return null
        }
      })
      .filter(
        (metadata): metadata is M & { fileName: string } => metadata !== null,
      )
  }

  public async read(fileName: string): Promise<T | null> {
    await this.directoryReady
    const filePath = this.getFilePath(fileName)
    if (!(await this.app.vault.adapter.exists(filePath))) return null

    const fileStat = await this.app.vault.adapter.stat(filePath)
    if (fileStat?.type === 'file' && fileStat.size > MAX_JSON_FILE_BYTES) {
      return null
    }

    const content = await this.app.vault.adapter.read(filePath)
    if (isJsonFileTooLarge(content)) return null

    try {
      const row: unknown = JSON.parse(content)
      return this.isValidRow(row) ? row : null
    } catch {
      return null
    }
  }

  public async delete(fileName: string): Promise<void> {
    await this.directoryReady
    const filePath = this.getFilePath(fileName)
    if (await this.app.vault.adapter.exists(filePath)) {
      await this.app.vault.adapter.remove(filePath)
    }
  }
}
