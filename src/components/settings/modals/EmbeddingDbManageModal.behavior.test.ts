import * as fs from 'fs'
import * as path from 'path'

test('guards and cancels embedding index rebuilds', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/components/settings/modals/EmbeddingDbManageModal.tsx',
    ),
    'utf8',
  )

  expect(source).toContain('rebuildControllersRef.current.has(modelId)')
  expect(source).toContain('signal: abortController.signal')
  expect(source).toContain(
    'rebuildControllers.forEach((controller) => controller.abort())',
  )
  expect(source).toContain(
    'if (!mountedRef.current || abortController.signal.aborted) return',
  )
})
