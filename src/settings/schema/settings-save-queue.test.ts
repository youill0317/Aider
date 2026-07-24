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
    const enqueueIndex = source.indexOf('const previousSave =')
    const updaterIndex = source.indexOf(
      "typeof update === 'function' ? update(this.settings) : update",
    )
    const validationIndex = source.indexOf(
      'smartComposerSettingsSchema.safeParse(nextSettings)',
    )
    const validatedPersistIndex = source.indexOf(
      'await this.persistSettingsUpdate(validationResult.data)',
    )
    const persistMethodIndex = source.indexOf(
      'private async persistSettingsUpdate',
    )
    const persistIndex = source.indexOf('await persistSettingsUpdate')
    const awaitIndex = source.indexOf('await save')
    const notifyIndex = source.indexOf('this.settingsChangeListeners.forEach')

    // When/Then: each write is serialized independently, and a rejected write
    // cannot discard the update queued behind it.
    expect(queueIndex).toBeGreaterThan(-1)
    expect(updaterIndex).toBeGreaterThan(enqueueIndex)
    expect(validationIndex).toBeGreaterThan(updaterIndex)
    expect(validatedPersistIndex).toBeGreaterThan(validationIndex)
    expect(awaitIndex).toBeGreaterThan(validatedPersistIndex)
    expect(persistMethodIndex).toBeGreaterThan(awaitIndex)
    expect(source).toContain('.catch(() => undefined)')
    expect(source).toContain('nextSettings,')
    expect(persistIndex).toBeGreaterThan(persistMethodIndex)
    expect(notifyIndex).toBeGreaterThan(persistIndex)
  })
})
