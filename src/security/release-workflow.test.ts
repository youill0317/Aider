import * as fs from 'fs'
import * as path from 'path'

describe('release workflow trust boundary', () => {
  it('keeps repository scripts out of the write-token job', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'release.yml'),
      'utf8',
    )
    const header = workflow.slice(0, workflow.indexOf('\njobs:'))
    const publishStart = workflow.indexOf('\n  publish:')
    const build = workflow.slice(workflow.indexOf('\n  build:'), publishStart)
    const publish = workflow.slice(publishStart)

    expect(publishStart).toBeGreaterThan(-1)
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).not.toContain('npm install')
    expect(build).toContain('persist-credentials: false')
    expect(build).toContain('npm ci')
    expect(`${header}\n${build}`).not.toMatch(/^\s+[\w-]+:\s+write\s*$/m)
    expect(publish).toContain('needs: build')
    expect(publish).toContain('contents: write')
    expect(publish).toContain('pull-requests: write')
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2)

    const runBlocks = [
      ...publish.matchAll(/^\s{8}run: \|\n((?:^\s{10}.*\n?)*)/gm),
    ]
    expect(publish.match(/^\s{8}run:/gm)).toHaveLength(runBlocks.length)
    expect(
      runBlocks.flatMap(([, block]) =>
        block
          .trim()
          .split('\n')
          .map((line) => line.trim()),
      ),
    ).toEqual([
      'cp release-bundle/manifest.json manifest.json',
      'cp release-bundle/versions.json versions.json',
      'cp release-bundle/package.json package.json',
      'cp release-bundle/package-lock.json package-lock.json',
      'gh release create "$TAG" \\',
      '--title="$TAG" \\',
      'release-bundle/main.js \\',
      'release-bundle/manifest.json \\',
      'release-bundle/styles.css',
    ])

    const actionRefs = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)]
    expect(actionRefs).not.toHaveLength(0)
    for (const [, ref] of actionRefs) {
      expect(ref).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/)
    }
  })
})
