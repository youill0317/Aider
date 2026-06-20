type ListedFiles = {
  readonly files: readonly string[]
  readonly folders: readonly string[]
}

class MemoryVaultAdapter {
  private readonly textFiles = new Map<string, string>()
  private readonly binaryFiles = new Map<string, ArrayBuffer>()
  private readonly folders = new Set<string>()
  private listError: Error | null = null

  async exists(path: string): Promise<boolean> {
    return (
      this.textFiles.has(path) ||
      this.binaryFiles.has(path) ||
      this.folders.has(path)
    )
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean)
    let currentPath = ''

    for (const part of parts) {
      currentPath = currentPath === '' ? part : `${currentPath}/${part}`
      this.folders.add(currentPath)
    }
  }

  async read(path: string): Promise<string> {
    const content = this.textFiles.get(path)
    if (content === undefined) {
      throw new Error(`Missing text file: ${path}`)
    }
    return content
  }

  async write(path: string, content: string): Promise<void> {
    this.textFiles.set(path, content)
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const content = this.binaryFiles.get(path)
    if (content === undefined) {
      throw new Error(`Missing binary file: ${path}`)
    }
    return content.slice(0)
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.binaryFiles.set(path, content.slice(0))
  }

  async list(path: string): Promise<ListedFiles> {
    if (this.listError !== null) {
      throw this.listError
    }

    const prefix = `${path}/`
    const files = [
      ...Array.from(this.textFiles.keys()),
      ...Array.from(this.binaryFiles.keys()),
    ].filter((filePath) => isDirectChild(prefix, filePath))
    const folders = Array.from(this.folders).filter((folderPath) =>
      isDirectChild(prefix, folderPath),
    )

    return { files, folders }
  }

  failLists(error: Error): void {
    this.listError = error
  }
}

export type TestApp = {
  readonly vault: {
    readonly configDir: string
    readonly adapter: MemoryVaultAdapter
  }
}

export function createTestApp(): TestApp {
  return {
    vault: {
      configDir: '.obsidian',
      adapter: new MemoryVaultAdapter(),
    },
  }
}

export function encodeText(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

export function decodeText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer)
}

export function jsonFile(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function isDirectChild(prefix: string, path: string): boolean {
  if (!path.startsWith(prefix)) {
    return false
  }

  return !path.slice(prefix.length).includes('/')
}
