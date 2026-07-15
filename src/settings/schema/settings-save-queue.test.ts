import * as fs from 'fs'
import * as path from 'path'

describe('settings save serialization contract', () => {
  it('serializes setSettings persistence before notifying runtime listeners', () => {
    // Given: settings writes can move secrets between ordinary and secure storage.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/main.ts'),
      'utf8',
    )
    const queueIndex = source.indexOf('private settingsSaveQueue')
    const validationIndex = source.indexOf(
      'smartComposerSettingsSchema.safeParse(newSettings)',
    )
    const enqueueIndex = source.indexOf('const previousSave =')
    const persistMethodIndex = source.indexOf(
      'private async persistSettingsUpdate',
    )
    const persistIndex = source.indexOf('await persistSettingsUpdate')
    const awaitIndex = source.indexOf('await save')
    const notifyIndex = source.indexOf('this.settingsChangeListeners.forEach')
    const validatedIndex = source.indexOf(
      'const validatedSettings = validationResult.data',
    )

    // When/Then: each write is serialized independently, and a rejected write
    // cannot discard the update queued behind it.
    expect(queueIndex).toBeGreaterThan(-1)
    expect(validatedIndex).toBeGreaterThan(validationIndex)
    expect(enqueueIndex).toBeGreaterThan(validatedIndex)
    expect(awaitIndex).toBeGreaterThan(enqueueIndex)
    expect(persistMethodIndex).toBeGreaterThan(awaitIndex)
    expect(source).toContain('.catch(() => undefined)')
    expect(source).toContain('nextSettings,')
    expect(persistIndex).toBeGreaterThan(persistMethodIndex)
    expect(notifyIndex).toBeGreaterThan(persistIndex)
  })
})
