import { gzipSync } from 'zlib'

import type { App } from 'obsidian'
import { requestUrl } from 'obsidian'

import { MAX_PGLITE_DATABASE_BYTES } from '../constants'

import { DatabaseManager, decompressPGliteArchive } from './DatabaseManager'

jest.mock('obsidian', () => ({
  ...jest.requireActual<typeof import('../../__mocks__/obsidian')>(
    '../../__mocks__/obsidian',
  ),
  requestUrl: jest.fn(),
}))

const requestUrlMock = jest.mocked(requestUrl)

function createManager(adapter: Record<string, jest.Mock>) {
  return new DatabaseManager(
    {
      vault: {
        adapter: {
          exists: jest.fn().mockResolvedValue(false),
          remove: jest.fn().mockResolvedValue(undefined),
          rename: jest.fn().mockResolvedValue(undefined),
          ...adapter,
        },
      },
    } as unknown as App,
    'database.gz',
  )
}

function setPgClient(
  manager: DatabaseManager,
  pgClient: { dumpDataDir: jest.Mock; close?: jest.Mock },
): void {
  const writableManager = manager as unknown as {
    pgClient: { dumpDataDir: jest.Mock; close?: jest.Mock }
  }
  writableManager.pgClient = pgClient
}

describe('DatabaseManager integrity', () => {
  beforeEach(() => {
    requestUrlMock.mockReset()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('propagates an existing database read failure', async () => {
    const readError = new Error('corrupt database')
    const writeBinary = jest.fn()
    const app = {
      vault: {
        adapter: {
          writeBinary,
          exists: jest.fn().mockResolvedValue(true),
          stat: jest.fn().mockResolvedValue(null),
          readBinary: jest.fn().mockRejectedValue(readError),
        },
      },
    } as unknown as App

    await expect(DatabaseManager.create(app)).rejects.toBe(readError)
    expect(writeBinary).not.toHaveBeenCalled()
  })

  it('closes an opened client when initialization fails after loading it', async () => {
    const close = jest.fn().mockResolvedValue(undefined)
    const migrationError = new Error('migration failed')
    const prototype = DatabaseManager.prototype as unknown as {
      loadExistingDatabase: () => Promise<unknown>
      migrateDatabase: () => Promise<void>
    }
    jest
      .spyOn(prototype, 'loadExistingDatabase')
      .mockImplementation(async function (this: DatabaseManager) {
        setPgClient(this, {
          dumpDataDir: jest.fn(),
          close,
        })
        return {} as never
      })
    jest.spyOn(prototype, 'migrateDatabase').mockRejectedValue(migrationError)

    await expect(
      DatabaseManager.create({ vault: { adapter: {} } } as unknown as App),
    ).rejects.toBe(migrationError)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized database before reading it into memory', async () => {
    const readBinary = jest.fn()
    const app = {
      vault: {
        adapter: {
          exists: jest.fn().mockResolvedValue(true),
          stat: jest.fn().mockResolvedValue({
            type: 'file',
            ctime: 0,
            mtime: 0,
            size: MAX_PGLITE_DATABASE_BYTES + 1,
          }),
          readBinary,
        },
      },
    } as unknown as App

    await expect(DatabaseManager.create(app)).rejects.toThrow(
      'PGlite database archive is too large',
    )
    expect(readBinary).not.toHaveBeenCalled()
  })

  it('stops gzip expansion at the decompressed database limit', async () => {
    const compressed = gzipSync(Buffer.alloc(4096))

    await expect(
      decompressPGliteArchive(
        new Blob([Uint8Array.from(compressed)], {
          type: 'application/x-gzip',
        }),
        1024,
      ),
    ).rejects.toThrow('expands beyond the size limit')
  })

  it('coalesces same-turn saves and serializes a save requested during a dump', async () => {
    let releaseFirst: (() => void) | undefined
    let active = 0
    let maximumActive = 0
    const dumpDataDir = jest.fn().mockImplementation(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      if (dumpDataDir.mock.calls.length === 1) {
        await new Promise<void>((resolve) => (releaseFirst = resolve))
      }
      active -= 1
      return new Blob(['database'])
    })
    const writeBinary = jest.fn().mockResolvedValue(undefined)
    const manager = createManager({ writeBinary })
    setPgClient(manager, { dumpDataDir })

    const first = manager.save()
    const second = manager.save()
    await Promise.resolve()
    await Promise.resolve()
    expect(dumpDataDir).toHaveBeenCalledTimes(1)

    const third = manager.save()

    releaseFirst?.()
    await Promise.all([first, second, third])
    expect(maximumActive).toBe(1)
    expect(writeBinary).toHaveBeenCalledTimes(2)
  })

  it('propagates save failures', async () => {
    const saveError = new Error('disk full')
    const writeBinary = jest
      .fn()
      .mockRejectedValueOnce(saveError)
      .mockResolvedValue(undefined)
    const manager = createManager({
      writeBinary,
    })
    const dumpDataDir = jest.fn().mockResolvedValue(new Blob(['database']))
    setPgClient(manager, { dumpDataDir })

    await expect(manager.save()).rejects.toBe(saveError)
    await expect(manager.save()).resolves.toBeUndefined()
    expect(dumpDataDir).toHaveBeenCalledTimes(2)
  })

  it('writes database snapshots through an atomic sibling rename', async () => {
    const writeBinary = jest.fn().mockResolvedValue(undefined)
    const rename = jest.fn().mockResolvedValue(undefined)
    const manager = createManager({ writeBinary, rename })
    setPgClient(manager, {
      dumpDataDir: jest.fn().mockResolvedValue(new Blob(['database'])),
    })

    await manager.save()

    const temporaryPath = writeBinary.mock.calls[0]?.[0]
    expect(temporaryPath).toMatch(/^\.aider-.+\.tmp$/)
    expect(temporaryPath).not.toBe('database.gz')
    expect(rename).toHaveBeenCalledWith(temporaryPath, 'database.gz')
  })

  it('does not save a database that cannot be loaded within the size limit', async () => {
    const writeBinary = jest.fn()
    const dumpDataDir = jest.fn().mockResolvedValue({
      size: MAX_PGLITE_DATABASE_BYTES + 1,
    })
    const manager = createManager({ writeBinary })
    setPgClient(manager, { dumpDataDir })

    await expect(manager.save()).rejects.toThrow(
      'PGlite database archive is too large',
    )
    expect(dumpDataDir).toHaveBeenCalledWith('none')
    expect(writeBinary).not.toHaveBeenCalled()
  })

  it('closes and clears the database when the final save fails', async () => {
    const saveError = new Error('disk full')
    const close = jest.fn().mockResolvedValue(undefined)
    const manager = createManager({
      writeBinary: jest.fn().mockRejectedValue(saveError),
    })
    setPgClient(manager, {
      dumpDataDir: jest.fn().mockResolvedValue(new Blob(['database'])),
      close,
    })
    const state = manager as unknown as {
      pgClient: unknown
      db: unknown
    }
    state.db = {}

    await expect(manager.save()).rejects.toBe(saveError)

    await expect(manager.cleanup()).rejects.toBe(saveError)
    expect(close).toHaveBeenCalledTimes(1)
    expect(state.pgClient).toBeNull()
    expect(state.db).toBeNull()
  })

  it('drains vector mutations before the final database save', async () => {
    const dumpDataDir = jest.fn().mockResolvedValue(new Blob(['database']))
    const manager = createManager({
      writeBinary: jest.fn().mockResolvedValue(undefined),
    })
    setPgClient(manager, {
      dumpDataDir,
      close: jest.fn().mockResolvedValue(undefined),
    })
    const closeVectorManager = jest.fn(async () => {
      await manager.save()
    })
    const managerRegistry = DatabaseManager as unknown as {
      managers: WeakMap<
        DatabaseManager,
        { vectorManager: { close: () => Promise<void> } }
      >
    }
    managerRegistry.managers.set(manager, {
      vectorManager: { close: closeVectorManager },
    })

    await manager.cleanup()

    expect(closeVectorManager).toHaveBeenCalledTimes(1)
    expect(closeVectorManager.mock.invocationCallOrder[0]).toBeLessThan(
      dumpDataDir.mock.invocationCallOrder[0],
    )
  })

  it('passes only SHA-256 verified resource bytes to PGlite', async () => {
    const fsBundleBytes = Uint8Array.of(1).buffer
    const wasmBytes = Uint8Array.of(2).buffer
    const vectorBytes = Uint8Array.of(3).buffer
    requestUrlMock
      .mockResolvedValueOnce({ arrayBuffer: fsBundleBytes } as never)
      .mockResolvedValueOnce({ arrayBuffer: wasmBytes } as never)
      .mockResolvedValueOnce({ arrayBuffer: vectorBytes } as never)
    const digest = jest
      .spyOn(crypto.subtle, 'digest')
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          '8bbecccbe044329462c8fd5148019ba0f82daa95e7f7737e2e71f9ce1f8c9528',
        ),
      )
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          '6999f4a272f2c7a3ec9be4268f5c184dec973145ff0a3735b0f459a1a906e451',
        ),
      )
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          'd04da95473fd2706f2fe6147c260e2ed087fbe282791d0301a19ae89dcc5d5e1',
        ),
      )
    const wasmModule = {} as WebAssembly.Module
    const compile = jest
      .spyOn(WebAssembly, 'compile')
      .mockResolvedValue(wasmModule)

    const resources = await loadPGliteResources(createManager({}))

    expect(digest).toHaveBeenNthCalledWith(1, 'SHA-256', fsBundleBytes)
    expect(digest).toHaveBeenNthCalledWith(2, 'SHA-256', wasmBytes)
    expect(digest).toHaveBeenNthCalledWith(3, 'SHA-256', vectorBytes)
    expect(compile).toHaveBeenCalledWith(wasmBytes)
    expect(resources.wasmModule).toBe(wasmModule)
    expect(new Uint8Array(await resources.fsBundle.arrayBuffer())).toEqual(
      new Uint8Array(fsBundleBytes),
    )
    expect(
      Buffer.from(
        resources.vectorExtensionBundlePath.href.split(',')[1],
        'base64',
      ),
    ).toEqual(Buffer.from(vectorBytes))
    expect(resources.vectorExtensionBundlePath.protocol).toBe('data:')
  })

  it('loads verified PGlite resources from the persistent cache', async () => {
    const resourcesByName = {
      'postgres.data': Uint8Array.of(1).buffer,
      'postgres.wasm': Uint8Array.of(2).buffer,
      'vector.tar.gz': Uint8Array.of(3).buffer,
    }
    const readBinary = jest.fn(async (path: string) => {
      const name = Object.keys(resourcesByName).find((resource) =>
        path.includes(resource),
      ) as keyof typeof resourcesByName | undefined
      if (!name) throw new Error(`Unexpected cache path: ${path}`)
      return resourcesByName[name]
    })
    const manager = createManager({
      exists: jest.fn(async (path: string) => path.includes('.pglite-cache-')),
      stat: jest.fn().mockResolvedValue({ type: 'file', size: 1 }),
      readBinary,
    })
    jest
      .spyOn(crypto.subtle, 'digest')
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          '8bbecccbe044329462c8fd5148019ba0f82daa95e7f7737e2e71f9ce1f8c9528',
        ),
      )
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          '6999f4a272f2c7a3ec9be4268f5c184dec973145ff0a3735b0f459a1a906e451',
        ),
      )
      .mockResolvedValueOnce(
        hexToArrayBuffer(
          'd04da95473fd2706f2fe6147c260e2ed087fbe282791d0301a19ae89dcc5d5e1',
        ),
      )
    jest
      .spyOn(WebAssembly, 'compile')
      .mockResolvedValue({} as WebAssembly.Module)

    await loadPGliteResources(manager)

    expect(readBinary).toHaveBeenCalledTimes(3)
    expect(requestUrlMock).not.toHaveBeenCalled()
  })

  it('fails closed when a PGlite resource hash does not match', async () => {
    requestUrlMock.mockResolvedValue({
      arrayBuffer: Uint8Array.of(1).buffer,
    } as never)
    jest
      .spyOn(crypto.subtle, 'digest')
      .mockResolvedValue(new Uint8Array(32).buffer)
    const compile = jest.spyOn(WebAssembly, 'compile')

    await expect(loadPGliteResources(createManager({}))).rejects.toThrow(
      'PGlite resource integrity check failed',
    )
    expect(compile).not.toHaveBeenCalled()
  })
})

function loadPGliteResources(manager: DatabaseManager): Promise<{
  fsBundle: Blob
  wasmModule: WebAssembly.Module
  vectorExtensionBundlePath: URL
}> {
  return (
    manager as unknown as {
      loadPGliteResources(): Promise<{
        fsBundle: Blob
        wasmModule: WebAssembly.Module
        vectorExtensionBundlePath: URL
      }>
    }
  ).loadPGliteResources()
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes.buffer
}
