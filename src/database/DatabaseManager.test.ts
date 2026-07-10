import { App } from 'obsidian'

import { DatabaseManager } from './DatabaseManager'

jest.mock('obsidian')

function createManager(adapter: Record<string, jest.Mock>) {
  return new DatabaseManager(
    { vault: { adapter } } as unknown as App,
    'database.gz',
  )
}

function setPgClient(
  manager: DatabaseManager,
  pgClient: { dumpDataDir: jest.Mock },
): void {
  const writableManager = manager as unknown as {
    pgClient: { dumpDataDir: jest.Mock }
  }
  writableManager.pgClient = pgClient
}

describe('DatabaseManager integrity', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
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
          readBinary: jest.fn().mockRejectedValue(readError),
        },
      },
    } as unknown as App

    await expect(DatabaseManager.create(app)).rejects.toBe(readError)
    expect(writeBinary).not.toHaveBeenCalled()
  })

  it('serializes concurrent database dumps and writes', async () => {
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

    releaseFirst?.()
    await Promise.all([first, second])
    expect(maximumActive).toBe(1)
    expect(writeBinary).toHaveBeenCalledTimes(2)
  })

  it('propagates save failures', async () => {
    const saveError = new Error('disk full')
    const manager = createManager({
      writeBinary: jest.fn().mockRejectedValue(saveError),
    })
    setPgClient(manager, {
      dumpDataDir: jest.fn().mockResolvedValue(new Blob(['database'])),
    })

    await expect(manager.save()).rejects.toBe(saveError)
  })
})
