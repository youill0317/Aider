import { MAX_MENTIONABLE_IMAGE_BYTES } from '../../types/mentionable'

import { filesToMentionableImages } from './image'

describe('filesToMentionableImages', () => {
  const originalFileReader = globalThis.FileReader

  beforeEach(() => {
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: class {
        result: string | ArrayBuffer | null = null
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null

        readAsDataURL(file: File) {
          this.result = `data:${file.type};base64,${file.name}`
          queueMicrotask(() => this.onload?.({} as ProgressEvent<FileReader>))
        }
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: originalFileReader,
    })
    jest.restoreAllMocks()
  })

  it('keeps valid images when another image is rejected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    const valid = {
      name: 'valid.png',
      size: 10,
      type: 'image/png',
    } as File
    const oversized = {
      name: 'oversized.png',
      size: MAX_MENTIONABLE_IMAGE_BYTES + 1,
      type: 'image/png',
    } as File

    await expect(filesToMentionableImages([valid, oversized])).resolves.toEqual(
      [
        {
          type: 'image',
          name: 'valid.png',
          mimeType: 'image/png',
          data: 'data:image/png;base64,valid.png',
        },
      ],
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
