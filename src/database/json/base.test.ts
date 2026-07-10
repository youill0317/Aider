import { App } from 'obsidian'

import { AbstractJsonRepository } from './base'

type Row = { fileName: string; value: string }

class TestRepository extends AbstractJsonRepository<Row, { value: string }> {
  protected generateFileName(row: Row): string {
    return row.fileName
  }

  protected parseFileName(fileName: string): { value: string } | null {
    return { value: fileName }
  }
}

function createAdapter() {
  return {
    exists: jest.fn<Promise<boolean>, [string]>(),
    list: jest.fn(),
    mkdir: jest.fn<Promise<void>, [string]>(),
    read: jest.fn(),
    remove: jest.fn<Promise<void>, [string]>(),
    rename: jest.fn<Promise<void>, [string, string]>(),
    write: jest.fn<Promise<void>, [string, string]>(),
  }
}

describe('AbstractJsonRepository', () => {
  it('waits for its directory before writing and atomically renames', async () => {
    let finishMkdir: (() => void) | undefined
    const adapter = createAdapter()
    adapter.exists.mockResolvedValue(false)
    adapter.mkdir.mockImplementation(
      () => new Promise((resolve) => (finishMkdir = resolve)),
    )
    adapter.write.mockResolvedValue()
    adapter.rename.mockResolvedValue()
    const repository = new TestRepository(
      { vault: { adapter } } as unknown as App,
      'data',
    )

    const creating = repository.create({ fileName: 'row.json', value: 'ok' })
    await Promise.resolve()
    expect(adapter.write).not.toHaveBeenCalled()

    finishMkdir?.()
    await creating
    expect(adapter.write.mock.calls[0]?.[0]).toMatch(
      /^data\/row\.json\..+\.tmp$/,
    )
    expect(adapter.rename).toHaveBeenCalledWith(
      adapter.write.mock.calls[0]?.[0],
      'data/row.json',
    )
  })

  it('rejects paths outside the repository directory', async () => {
    const adapter = createAdapter()
    adapter.exists.mockResolvedValue(true)
    const repository = new TestRepository(
      { vault: { adapter } } as unknown as App,
      'data',
    )

    await expect(
      repository.create({ fileName: '../outside.json', value: 'no' }),
    ).rejects.toThrow('Invalid database file name')
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('keeps the original when atomic replacement fails', async () => {
    const adapter = createAdapter()
    adapter.exists.mockResolvedValue(true)
    adapter.write.mockResolvedValue()
    adapter.rename.mockRejectedValue(new Error('rename failed'))
    adapter.remove.mockResolvedValue()
    const repository = new TestRepository(
      { vault: { adapter } } as unknown as App,
      'data',
    )

    await expect(
      repository.update(
        { fileName: 'row.json', value: 'old' },
        { fileName: 'row.json', value: 'new' },
      ),
    ).rejects.toThrow('rename failed')
    expect(adapter.remove).toHaveBeenCalledTimes(1)
    expect(adapter.remove.mock.calls[0]?.[0]).not.toBe('data/row.json')
  })
})
