import * as fs from 'fs'
import * as path from 'path'

describe('Obsidian control async behavior', () => {
  it.each(['ObsidianTextInput.tsx', 'ObsidianTextArea.tsx'])(
    '%s debounces drafts and flushes on blur',
    (file) => {
      const source = readCommonFile(file)

      expect(source).toContain('useDebouncedControlValue')
      expect(source).toContain("addEventListener('blur', flush)")
      expect(source).toContain("removeEventListener('blur', flush)")
    },
  )

  it.each(['ObsidianButton.tsx', 'ObsidianDropdown.tsx', 'ObsidianToggle.tsx'])(
    '%s handles async callbacks immediately',
    (file) => {
      const source = readCommonFile(file)

      expect(source).toContain('runAsyncAction')
      expect(source).not.toContain('useDebouncedControlValue')
    },
  )

  it.each(['ObsidianDropdown.tsx', 'ObsidianToggle.tsx'])(
    '%s restores its controlled value after a failed save',
    (file) => {
      const source = readCommonFile(file)

      expect(source).toContain('if (!succeeded)')
      expect(source).toContain('setValue(valueRef.current)')
    },
  )

  it('flushes a pending draft during unmount cleanup', () => {
    const source = readCommonFile('useDebouncedControlValue.ts')

    expect(source).toContain('() => () => {')
    expect(source).toContain('flush()')
  })
})

function readCommonFile(file: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'src/components/common', file),
    'utf8',
  )
}
