import {
  AtomicWriteRecoveryError,
  writeBinaryFileAtomically,
  writeFileAtomically,
} from './atomic-file'

// Mirrors Obsidian's DataAdapter: rename throws when the destination exists.
function createObsidianLikeAdapter(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    exists: (path: string) => Promise.resolve(files.has(path)),
    read: (path: string) => Promise.resolve(files.get(path) ?? ''),
    readBinary: (path: string) =>
      Promise.resolve(new TextEncoder().encode(files.get(path) ?? '').buffer),
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

describe('AtomicWriteRecoveryError', () => {
  it('renders every backup path, not just the first', () => {
    const error = new AtomicWriteRecoveryError(
      'a.tmp',
      new Error('replace'),
      new Error('restore'),
      ['b.tmp'],
    )

    expect(error.backupPathList).toBe('"a.tmp", "b.tmp"')
  })
})

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

  it('copies the backup back when restoring it by rename fails', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let renames = 0
    const failing = {
      ...adapter,
      rename: (from: string, to: string) => {
        renames += 1
        return renames === 1
          ? adapter.rename(from, to)
          : Promise.reject(new Error('rename failed'))
      },
    }

    await expect(writeFileAtomically(failing, 'a.json', 'new')).rejects.toThrow(
      'rename failed',
    )
    expect(adapter.files.get('a.json')).toBe('old')
    expect([...adapter.files.keys()]).toEqual(['a.json'])
  })

  it('reports the backup path when every restore method fails', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let renames = 0
    const failing = {
      ...adapter,
      rename: (from: string, to: string) => {
        renames += 1
        return renames === 1
          ? adapter.rename(from, to)
          : Promise.reject(new Error('rename failed'))
      },
      write: (path: string, content: string) =>
        path === 'a.json'
          ? Promise.reject(new Error('restore failed'))
          : adapter.write(path, content),
    }

    const error = await writeFileAtomically(failing, 'a.json', 'new').catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(AtomicWriteRecoveryError)
    expect(error).toMatchObject({
      backupPath: expect.stringMatching(/^\.aider-.+\.tmp$/),
      replacementError: expect.objectContaining({ message: 'rename failed' }),
      restoreError: expect.objectContaining({ message: 'restore failed' }),
    })
    expect([...adapter.files.values()]).toEqual(['old'])
  })

  it('reports the backup path when the target cannot be checked', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let existsCalls = 0
    const failing = {
      ...adapter,
      exists: (path: string) => {
        existsCalls += 1
        return existsCalls === 2
          ? Promise.reject(new Error('stat failed'))
          : adapter.exists(path)
      },
      rename: (from: string, to: string) =>
        to === 'a.json'
          ? Promise.reject(new Error('rename failed'))
          : adapter.rename(from, to),
    }

    const error = await writeFileAtomically(failing, 'a.json', 'new').catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(AtomicWriteRecoveryError)
    expect(error).toMatchObject({
      backupPath: expect.stringMatching(/^\.aider-.+\.tmp$/),
      restoreError: expect.objectContaining({ message: 'stat failed' }),
    })
    expect([...adapter.files.values()]).toContain('old')
  })

  it('reports the backup path when another writer creates the target', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let renames = 0
    const concurrent = {
      ...adapter,
      rename: (from: string, to: string) => {
        renames += 1
        if (renames === 1) return adapter.rename(from, to)
        adapter.files.set('a.json', 'concurrent')
        return Promise.reject(new Error('destination exists'))
      },
    }

    const error = await writeFileAtomically(concurrent, 'a.json', 'new').catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(AtomicWriteRecoveryError)
    expect(error).toMatchObject({
      backupPath: expect.stringMatching(/^\.aider-.+\.tmp$/),
      restoreError: expect.objectContaining({
        message: 'Restore skipped because another writer created the target',
      }),
    })
    expect(adapter.files.get('a.json')).toBe('concurrent')
    expect([...adapter.files.values()]).toContain('old')
  })

  it('does not copy the backup over a target another writer created mid-restore', async () => {
    const adapter = createObsidianLikeAdapter({ 'a.json': 'old' })
    let targetChecks = 0
    let renames = 0
    const racing = {
      ...adapter,
      // Absent when recovery starts, present by the time the restore rename
      // fails - the window this guard exists for.
      exists: (path: string) => {
        if (path !== 'a.json') return adapter.exists(path)
        targetChecks += 1
        return Promise.resolve(targetChecks !== 2)
      },
      rename: (from: string, to: string) => {
        renames += 1
        return renames === 1
          ? adapter.rename(from, to)
          : Promise.reject(new Error('rename failed'))
      },
      write: (path: string, content: string) =>
        path === 'a.json'
          ? Promise.reject(new Error('restore must not run'))
          : adapter.write(path, content),
    }

    const error = await writeFileAtomically(racing, 'a.json', 'new').catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(AtomicWriteRecoveryError)
    expect(error).toMatchObject({
      restoreError: expect.objectContaining({
        message: 'Restore skipped because another writer created the target',
      }),
    })
    expect([...adapter.files.values()]).toContain('old')
  })

  it('overwrites binary files too', async () => {
    const adapter = createObsidianLikeAdapter({ 'db.tar.gz': 'old' })

    await writeBinaryFileAtomically(adapter, 'db.tar.gz', new ArrayBuffer(8))

    expect(adapter.files.get('db.tar.gz')).toBe('binary:8')
  })

  it('copies a binary backup back when both renames fail', async () => {
    const adapter = createObsidianLikeAdapter({ 'db.tar.gz': 'old' })
    let renames = 0
    const failing = {
      ...adapter,
      rename: (from: string, to: string) => {
        renames += 1
        return renames === 1
          ? adapter.rename(from, to)
          : Promise.reject(new Error('rename failed'))
      },
    }

    await expect(
      writeBinaryFileAtomically(failing, 'db.tar.gz', new ArrayBuffer(8)),
    ).rejects.toThrow('rename failed')
    expect(adapter.files.get('db.tar.gz')).toBe('binary:3')
    expect([...adapter.files.keys()]).toEqual(['db.tar.gz'])
  })
})
