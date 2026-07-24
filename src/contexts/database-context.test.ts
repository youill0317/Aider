import * as fs from 'fs'
import * as path from 'path'

test('initializes the database only when a consumer requests it', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/contexts/database-context.tsx'),
    'utf8',
  )

  expect(source).not.toContain('void getDatabaseManager()')
  expect(source).toContain(
    'return (await getDatabaseManager()).getVectorManager()',
  )
})
