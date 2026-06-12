import * as fs from 'fs'
import * as path from 'path'

describe('settings UX contract', () => {
  it('settings section order is unchanged', () => {
    // Given: the settings root declares the visible section order.
    const source = readProjectFile(
      'src/components/settings/SettingsTabRoot.tsx',
    )

    // When: section components are read in render order.
    const order = [
      '<PlanConnectionsSection',
      '<ChatSection',
      '<ProvidersSection',
      '<ModelsSection',
      '<RAGSection',
      '<McpSection',
      '<TemplateSection',
      '<EtcSection',
    ].map((token) => source.indexOf(token))

    // Then: the existing section order remains stable.
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  it('tool approval labels are unchanged', () => {
    // Given: tool approval UI owns the visible approval labels.
    const source = readProjectFile('src/components/chat-view/ToolMessage.tsx')

    // When/Then: existing labels remain present.
    expect(source).toContain('primaryText="Allow"')
    expect(source).toContain("label: 'Always allow this tool'")
    expect(source).toContain("label: 'Allow for this chat'")
    expect(source).toContain('Reject')
    expect(source).toContain('Abort')
  })

  it('provider table API key labels are unchanged', () => {
    // Given: provider settings own the API key display label.
    const source = readProjectFile(
      'src/components/settings/sections/ProvidersSection.tsx',
    )

    // When/Then: the masked key and setup prompt remain present.
    expect(source).toContain("'••••••••' : 'Set API key'")
  })

  it('subscription connection copy is unchanged', () => {
    // Given: subscription cards own the connect/disconnect copy.
    const source = readProjectFile(
      'src/components/settings/sections/PlanConnectionsSection.tsx',
    )

    // When/Then: existing headings and action labels remain present.
    expect(source).toContain('Connect your subscription')
    expect(source).toContain('Use a subscription instead of API-key billing')
    expect(source).toContain('Connect')
    expect(source).toContain('Disconnect')
  })
})

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}
