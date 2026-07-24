import { TFile, Vault } from 'obsidian'

import { applyFileChangeIfCurrent } from './apply-file-change'

describe('applyFileChangeIfCurrent', () => {
  it('does not overwrite a file that changed during review', async () => {
    let content = 'newer user edit'
    const process = jest.fn(
      async (_file: TFile, update: (currentContent: string) => string) => {
        content = update(content)
        return content
      },
    )
    const vault = {
      process,
    } as unknown as Pick<Vault, 'process'>

    await expect(
      applyFileChangeIfCurrent(
        vault,
        {} as TFile,
        'reviewed original',
        'suggestion',
      ),
    ).resolves.toBe(false)
    expect(content).toBe('newer user edit')
    expect(process).toHaveBeenCalledTimes(1)
  })

  it('atomically writes when the reviewed original is still current', async () => {
    const file = {} as TFile
    let content = 'reviewed original'
    const process = jest.fn(
      async (_file: TFile, update: (currentContent: string) => string) => {
        content = update(content)
        return content
      },
    )
    const vault = {
      process,
    } as unknown as Pick<Vault, 'process'>

    await expect(
      applyFileChangeIfCurrent(vault, file, 'reviewed original', 'suggestion'),
    ).resolves.toBe(true)
    expect(content).toBe('suggestion')
    expect(process).toHaveBeenCalledWith(file, expect.any(Function))
  })

  it('propagates vault errors', async () => {
    const error = new Error('disk unavailable')
    const vault = {
      process: jest.fn().mockRejectedValue(error),
    } as unknown as Pick<Vault, 'process'>

    await expect(
      applyFileChangeIfCurrent(
        vault,
        {} as TFile,
        'reviewed original',
        'suggestion',
      ),
    ).rejects.toBe(error)
  })
})
