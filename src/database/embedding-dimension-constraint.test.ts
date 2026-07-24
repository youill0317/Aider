import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrations = require('./migrations.json') as {
  sql: string[]
}[]

const execFileAsync = promisify(execFile)

jest.setTimeout(30_000)

describe('embedding dimension database constraint', () => {
  it('removes legacy mismatches and rejects new ones', async () => {
    const migration = migrations.find((candidate) =>
      candidate.sql.some((statement) =>
        statement.includes('embeddings_embedding_dimension_check'),
      ),
    )
    expect(migration).toBeDefined()

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', integrationScript],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DIMENSION_MIGRATION_SQL: JSON.stringify(migration?.sql ?? []),
        },
      },
    )

    expect(stdout).toContain('dimension constraint verified')
  })
})

const integrationScript = `
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

const database = await PGlite.create({ extensions: { vector } })
try {
  await database.exec(\`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE embeddings (
      id serial PRIMARY KEY,
      path text NOT NULL,
      model text NOT NULL,
      dimension smallint NOT NULL,
      embedding vector
    );
    INSERT INTO embeddings (path, model, dimension, embedding)
    VALUES
      ('affected.md', 'model-a', 4, '[1,0,0,0]'),
      ('affected.md', 'model-a', 4, '[1,2,3]'),
      ('unrelated.md', 'model-b', 3, '[1,2,3]');
  \`)
  for (const statement of JSON.parse(process.env.DIMENSION_MIGRATION_SQL ?? '[]')) {
    await database.exec(statement)
  }
  const remaining = await database.query(
    'SELECT path, model FROM embeddings ORDER BY path, model',
  )
  if (
    remaining.rows.length !== 1 ||
    remaining.rows[0]?.path !== 'unrelated.md' ||
    remaining.rows[0]?.model !== 'model-b'
  ) {
    throw new Error('migration did not invalidate the affected index group')
  }
  let rejected = false
  try {
    await database.exec(\`
      INSERT INTO embeddings (path, model, dimension, embedding)
      VALUES ('new.md', 'model-c', 3072, '[1,2,3]');
    \`)
  } catch (error) {
    rejected = String(error).includes('embeddings_embedding_dimension_check')
  }
  if (!rejected) throw new Error('dimension mismatch was accepted')
  await database.exec(\`
    INSERT INTO embeddings (path, model, dimension, embedding)
    VALUES ('new.md', 'model-c', 3, '[1,2,3]');
  \`)
  console.log('dimension constraint verified')
} finally {
  await database.close()
}
`
