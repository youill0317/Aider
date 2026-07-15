import type { TFile, Vault } from 'obsidian'

export async function applyFileChangeIfCurrent(
  vault: Pick<Vault, 'modify' | 'read'>,
  file: TFile,
  originalContent: string,
  newContent: string,
): Promise<boolean> {
  if ((await vault.read(file)) !== originalContent) return false
  await vault.modify(file, newContent)
  return true
}
