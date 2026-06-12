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
    const assignIndex = source.indexOf('this.settingsSaveQueue =')
    const persistIndex = source.indexOf('await persistSettingsUpdate')
    const awaitIndex = source.indexOf('await this.settingsSaveQueue')
    const notifyIndex = source.indexOf('this.settingsChangeListeners.forEach')

    // When/Then: each save is chained onto the previous save and listeners run after it.
    expect(queueIndex).toBeGreaterThan(-1)
    expect(assignIndex).toBeGreaterThan(queueIndex)
    expect(source).toContain('.catch(() => undefined)')
    expect(persistIndex).toBeGreaterThan(assignIndex)
    expect(awaitIndex).toBeGreaterThan(persistIndex)
    expect(notifyIndex).toBeGreaterThan(awaitIndex)
  })
})
