import { MAX_MENTIONABLE_IMAGE_BYTES } from '../../types/mentionable'

import { convertFilesToMentionableImages } from './image'

describe('convertFilesToMentionableImages', () => {
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

    await expect(
      convertFilesToMentionableImages([valid, oversized]),
    ).resolves.toEqual({
      images: [
        {
          type: 'image',
          name: 'valid.png',
          mimeType: 'image/png',
          data: 'data:image/png;base64,valid.png',
        },
      ],
      rejected: [
        {
          name: 'oversized.png',
          reason: 'Image file is too large',
        },
      ],
    })
  })

  it('reports rejected image names and reasons to the UI boundary', async () => {
    const oversized = {
      name: 'oversized.png',
      size: MAX_MENTIONABLE_IMAGE_BYTES + 1,
      type: 'image/png',
    } as File

    await expect(convertFilesToMentionableImages([oversized])).resolves.toEqual(
      {
        images: [],
        rejected: [
          {
            name: 'oversized.png',
            reason: 'Image file is too large',
          },
        ],
      },
    )
  })
})
