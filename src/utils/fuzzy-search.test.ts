import { App } from 'obsidian'

import { createCachedFuzzySearch } from './fuzzy-search'

it('reuses the mention index until a vault event invalidates it', () => {
  const callbacks = new Map<string, () => void>()
  const vault = {
    getFiles: jest.fn(() => [
      {
        extension: 'md',
        name: 'Note.md',
        path: 'Note.md',
        stat: { mtime: Date.now() },
      },
    ]),
    getAllFolders: jest.fn(() => []),
    on: jest.fn((event: string, callback: () => void) => {
      callbacks.set(event, callback)
      return { event }
    }),
    offref: jest.fn(),
  }
  const workspace = {
    getActiveFile: jest.fn(() => null),
    getLeavesOfType: jest.fn(() => []),
    on: jest.fn((_event: string, _callback: () => void) => ({})),
    offref: jest.fn(),
  }
  const search = createCachedFuzzySearch({
    vault,
    workspace,
  } as unknown as App)

  expect(search.search('')).toHaveLength(2)
  expect(search.search('')).toHaveLength(2)
  expect(vault.getFiles).toHaveBeenCalledTimes(1)

  callbacks.get('create')?.()
  expect(search.search('')).toHaveLength(2)
  expect(vault.getFiles).toHaveBeenCalledTimes(2)

  search.dispose()
  expect(vault.offref).toHaveBeenCalledTimes(4)
  expect(workspace.offref).toHaveBeenCalledTimes(2)
})
