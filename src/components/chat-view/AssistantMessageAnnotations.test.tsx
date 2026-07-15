import { renderToStaticMarkup } from 'react-dom/server'

import AssistantMessageAnnotations from './AssistantMessageAnnotations'

const runtimeGlobal = globalThis as typeof globalThis & {
  require?: NodeRequire
}
const originalRequire = runtimeGlobal.require

describe('AssistantMessageAnnotations', () => {
  beforeAll(() => {
    runtimeGlobal.require = require
  })

  afterAll(() => {
    runtimeGlobal.require = originalRequire
  })

  it('links only public HTTP(S) citations', () => {
    const html = renderToStaticMarkup(
      <AssistantMessageAnnotations
        annotations={[
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://example.com/source',
              title: 'Public source',
            },
          },
          {
            type: 'url_citation',
            url_citation: {
              url: 'http://localhost/admin',
              title: 'Local source',
            },
          },
          {
            type: 'url_citation',
            url_citation: {
              url: 'javascript:alert(document.domain)',
              title: 'Unsafe source',
            },
          },
        ]}
      />,
    )

    expect(html).toContain('href="https://example.com/source"')
    expect(html).toContain('Local source')
    expect(html).toContain('Unsafe source')
    expect(html).not.toContain('href="http://localhost/admin"')
    expect(html).not.toContain('href="javascript:')
  })
})
