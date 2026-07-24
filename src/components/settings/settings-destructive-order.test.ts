import * as fs from 'fs'
import * as path from 'path'

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('destructive settings actions', () => {
  it('persists provider removal before deleting rebuildable vectors', () => {
    const source = read('src/components/settings/sections/ProvidersSection.tsx')

    expect(source.indexOf('await setSettings')).toBeLessThan(
      source.indexOf('clearAllVectorsForModels'),
    )
  })

  it('persists model removal before deleting rebuildable vectors', () => {
    const source = read(
      'src/components/settings/sections/models/EmbeddingModelsSubSection.tsx',
    )

    expect(source.indexOf('await setSettings')).toBeLessThan(
      source.indexOf('clearAllVectors(modelId)'),
    )
  })

  it('revokes local trust before resetting settings', () => {
    const source = read('src/components/settings/sections/EtcSection.tsx')

    expect(source.indexOf('plugin.revokeProviderRouteTrust')).toBeLessThan(
      source.indexOf('await setSettings'),
    )
    expect(source.indexOf('plugin.revokeMcpServerTrust')).toBeLessThan(
      source.indexOf('await setSettings'),
    )
  })

  it('revokes command trust before deleting an MCP server', () => {
    const source = read('src/components/settings/sections/McpSection.tsx')
    const deleteHandler = source.slice(
      source.indexOf('const handleDelete ='),
      source.indexOf('const handleToggleEnabled ='),
    )

    expect(deleteHandler.indexOf('plugin.revokeMcpServerTrust')).toBeLessThan(
      deleteHandler.indexOf('await setSettings'),
    )
  })
})
