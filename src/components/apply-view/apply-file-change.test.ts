import { TFile, Vault } from 'obsidian'

import { applyFileChangeIfCurrent } from './apply-file-change'

describe('applyFileChangeIfCurrent', () => {
  it('does not overwrite a file that changed during review', async () => {
    const modify = jest.fn()
    const vault = {
      read: jest.fn().mockResolvedValue('newer user edit'),
      modify,
    } as unknown as Pick<Vault, 'modify' | 'read'>

    await expect(
      applyFileChangeIfCurrent(
        vault,
        {} as TFile,
        'reviewed original',
        'suggestion',
      ),
    ).resolves.toBe(false)
    expect(modify).not.toHaveBeenCalled()
  })

  it('writes when the reviewed original is still current', async () => {
    const file = {} as TFile
    const modify = jest.fn().mockResolvedValue(undefined)
    const vault = {
      read: jest.fn().mockResolvedValue('reviewed original'),
      modify,
    } as unknown as Pick<Vault, 'modify' | 'read'>

    await expect(
      applyFileChangeIfCurrent(vault, file, 'reviewed original', 'suggestion'),
    ).resolves.toBe(true)
    expect(modify).toHaveBeenCalledWith(file, 'suggestion')
  })
})
