import type { TFile, Vault } from 'obsidian'

const FILE_CHANGED_DURING_REVIEW = new Error('File changed during review')

export async function applyFileChangeIfCurrent(
  vault: Pick<Vault, 'process'>,
  file: TFile,
  originalContent: string,
  newContent: string,
): Promise<boolean> {
  try {
    await vault.process(file, (currentContent) => {
      if (currentContent !== originalContent) {
        throw FILE_CHANGED_DURING_REVIEW
      }
      return newContent
    })
    return true
  } catch (error) {
    if (error === FILE_CHANGED_DURING_REVIEW) return false
    throw error
  }
}
