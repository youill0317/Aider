import { writeBinaryFileAtomically, writeFileAtomically } from './atomic-file'

// Mirrors Obsidian's DataAdapter: rename throws when the destination exists.
function createObsidianLikeAdapter(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    exists: (path: string) => Promise.resolve(files.has(path)),
    remove: (path: string) => {
      files.delete(path)
      return Promise.resolve()
    },
    rename: (from: string, to: string) => {
      if (files.has(to)) {
        return Promise.reject(new Error('Destination file already exists!'))
      }
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return Promise.resolve()
    },
    write: (path: string, content: string) => {
      files.set(path, content)
      return Promise.resolve()
    },
    writeBinary: (path: string, content: ArrayBuffer) => {
      files.set(path, `binary:${content.byteLength}`)
      return Promise.resolve()
    },
  }
}

describe('writeFileAtomically', () => {
  it('overwrites an existing file', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })

    await writeFileAtomically(adapter, 'a.json', 'new')

    expect(adapter.files.get('a.json')).toBe('new')
    expect([...adapter.files.keys()]).toEqual(['a.json'])
  })

  it('creates a file that does not exist yet', async () => {
    const adapter = createObsidianLikeAdapter()

    await writeFileAtomically(adapter, 'a.json', 'new')

    expect(adapter.files.get('a.json')).toBe('new')
  })

  it('leaves no temporary file behind when the write fails', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    const failing = {
      ...adapter,
      write: () => Promise.reject(new Error('disk full')),
    }

    await expect(writeFileAtomically(failing, 'a.json', 'new')).rejects.toThrow(
      'disk full',
    )
    expect(adapter.files.get('a.json')).toBe('old')
    expect([...adapter.files.keys()]).toEqual(['a.json'])
  })

  it('restores the original when the replacement rename fails', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let renames = 0
    const failing = {
      ...adapter,
      rename: (from: string, to: string) => {
        renames += 1
        // 1 moves the original aside, 2 installs the replacement, 3 restores.
        return renames === 2
          ? Promise.reject(new Error('rename failed'))
          : adapter.rename(from, to)
      },
    }

    await expect(writeFileAtomically(failing, 'a.json', 'new')).rejects.toThrow(
      'rename failed',
    )
    expect(adapter.files.get('a.json')).toBe('old')
    expect([...adapter.files.keys()]).toEqual(['a.json'])
  })

  it('overwrites binary files too', async () => {
    const adapter = createObsidianLikeAdapter({ 'db.tar.gz': 'old' })

    await writeBinaryFileAtomically(adapter, 'db.tar.gz', new ArrayBuffer(8))

    expect(adapter.files.get('db.tar.gz')).toBe('binary:8')
  })
})
