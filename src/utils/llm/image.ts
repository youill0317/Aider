import {
  MAX_MENTIONABLE_IMAGE_BYTES,
  MentionableImage,
} from '../../types/mentionable'

export function parseImageDataUrl(dataUrl: string): {
  mimeType: string
  base64Data: string
} {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)/)
  if (!matches) {
    throw new Error('Invalid image data URL format')
  }
  const [, mimeType, base64Data] = matches
  return { mimeType, base64Data }
}

async function fileToMentionableImage(file: File): Promise<MentionableImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached')
  }
  if (file.size > MAX_MENTIONABLE_IMAGE_BYTES) {
    throw new Error('Image file is too large')
  }
  const base64Data = await fileToBase64(file)
  return {
    type: 'image',
    name: file.name,
    mimeType: file.type,
    data: base64Data,
  }
}

export async function convertFilesToMentionableImages(
  files: readonly File[],
): Promise<{
  images: MentionableImage[]
  rejected: { name: string; reason: string }[]
}> {
  const results = await Promise.allSettled(files.map(fileToMentionableImage))
  return {
    images: results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    ),
    rejected: results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              name: files[index]?.name ?? 'image',
              reason:
                result.reason instanceof Error
                  ? result.reason.message
                  : 'Unable to read image',
            },
          ]
        : [],
    ),
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
  })
}
