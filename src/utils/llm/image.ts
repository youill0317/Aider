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

export async function fileToMentionableImage(
  file: File,
): Promise<MentionableImage> {
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

export async function filesToMentionableImages(
  files: readonly File[],
): Promise<MentionableImage[]> {
  const results = await Promise.allSettled(files.map(fileToMentionableImage))
  if (results.some((result) => result.status === 'rejected')) {
    console.warn('Unable to attach one or more images')
  }
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
  })
}
