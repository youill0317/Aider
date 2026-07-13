export const MAX_JSON_FILE_NAME_BYTES = 220

export function encodeFileNameLabel(label: string): string {
  return encodeURIComponent(label).replace(/\*/g, '%2A')
}

export function fitLabelToFileName(
  label: string,
  fixedFileNameBytes: number,
): string {
  const availableBytes = MAX_JSON_FILE_NAME_BYTES - fixedFileNameBytes
  let result = ''
  let usedBytes = 0

  for (const character of label) {
    let safeCharacter = character
    let encodedCharacter: string
    try {
      encodedCharacter = encodeFileNameLabel(character)
    } catch {
      safeCharacter = '\uFFFD'
      encodedCharacter = '%EF%BF%BD'
    }
    if (usedBytes + encodedCharacter.length > availableBytes) break
    result += safeCharacter
    usedBytes += encodedCharacter.length
  }

  if (label.length > 0 && result.length === 0) {
    throw new Error('Database record identifier is too long')
  }
  return result
}
