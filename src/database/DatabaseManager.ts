import { PGlite } from '@electric-sql/pglite'
import { PgliteDatabase, drizzle } from 'drizzle-orm/pglite'
import { App, normalizePath, requestUrl } from 'obsidian'

import { MAX_PGLITE_DATABASE_BYTES, PGLITE_DB_PATH } from '../constants'
import { writeBinaryFileAtomically } from '../utils/atomic-file'
import { withRequestTimeout } from '../utils/llm/httpTransport'

import { PGLiteAbortedException } from './exception'
import migrations from './migrations.json'
import { LegacyTemplateManager } from './modules/template/TemplateManager'
import { VectorManager } from './modules/vector/VectorManager'

const PGLITE_VERSION = '0.2.12'
const MAX_PGLITE_RESOURCE_BYTES = 32 * 1024 * 1024
const PGLITE_RESOURCE_SHA256 = {
  'postgres.data':
    '8bbecccbe044329462c8fd5148019ba0f82daa95e7f7737e2e71f9ce1f8c9528',
  'postgres.wasm':
    '6999f4a272f2c7a3ec9be4268f5c184dec973145ff0a3735b0f459a1a906e451',
  'vector.tar.gz':
    'd04da95473fd2706f2fe6147c260e2ed087fbe282791d0301a19ae89dcc5d5e1',
} as const

export class DatabaseManager {
  private app: App
  private dbPath: string
  private pgClient: PGlite | null = null
  private db: PgliteDatabase | null = null
  private saveQueue: Promise<void> | null = null
  private saveRequested = false
  // WeakMap to prevent circular references
  private static managers = new WeakMap<
    DatabaseManager,
    {
      templateManager?: LegacyTemplateManager
      vectorManager?: VectorManager
    }
  >()

  constructor(app: App, dbPath: string) {
    this.app = app
    this.dbPath = dbPath
  }

  static async create(app: App): Promise<DatabaseManager> {
    const dbManager = new DatabaseManager(app, normalizePath(PGLITE_DB_PATH))
    try {
      dbManager.db = await dbManager.loadExistingDatabase()
      const createdNewDatabase = !dbManager.db
      if (!dbManager.db) {
        dbManager.db = await dbManager.createNewDatabase()
      }
      const migrationsChanged = await dbManager.migrateDatabase()
      if (createdNewDatabase || migrationsChanged) {
        await dbManager.save()
      }

      // WeakMap setup
      const managers = {
        vectorManager: new VectorManager(app, dbManager.db),
      }

      // save, vacuum callback setup
      const saveCallback = dbManager.save.bind(dbManager) as () => Promise<void>
      const vacuumCallback = dbManager.vacuum.bind(
        dbManager,
      ) as () => Promise<void>

      managers.vectorManager.setSaveCallback(saveCallback)
      managers.vectorManager.setVacuumCallback(vacuumCallback)

      DatabaseManager.managers.set(dbManager, managers)

      console.log('Aider database initialized.', dbManager)

      return dbManager
    } catch (error) {
      await dbManager.closeAfterInitializationFailure()
      throw error
    }
  }

  private async closeAfterInitializationFailure(): Promise<void> {
    DatabaseManager.managers.delete(this)
    const pgClient = this.pgClient
    this.pgClient = null
    this.db = null
    try {
      await pgClient?.close()
    } catch (closeError) {
      console.error(
        'Failed to close database after initialization failure:',
        closeError,
      )
    }
  }

  getVectorManager(): VectorManager {
    const managers = DatabaseManager.managers.get(this) ?? {}
    if (!managers.vectorManager) {
      if (this.db) {
        managers.vectorManager = new VectorManager(this.app, this.db)
        DatabaseManager.managers.set(this, managers)
      } else {
        throw new Error('Database is not initialized')
      }
    }
    return managers.vectorManager
  }

  getTemplateManager(): LegacyTemplateManager {
    const managers = DatabaseManager.managers.get(this) ?? {}
    if (!managers.templateManager) {
      if (this.db) {
        managers.templateManager = new LegacyTemplateManager(this.db)
        managers.templateManager.setSaveCallback(() => this.save())
        DatabaseManager.managers.set(this, managers)
      } else {
        throw new Error('Database is not initialized')
      }
    }
    return managers.templateManager
  }

  // vacuum the database to release unused space
  async vacuum() {
    if (!this.pgClient) {
      return
    }
    await this.pgClient.query('VACUUM FULL;')
  }

  private async createNewDatabase() {
    try {
      const { fsBundle, wasmModule, vectorExtensionBundlePath } =
        await this.loadPGliteResources()
      this.pgClient = await PGlite.create({
        fsBundle: fsBundle,
        wasmModule: wasmModule,
        extensions: {
          vector: vectorExtensionBundlePath,
        },
      })
      const db = drizzle(this.pgClient)
      return db
    } catch (error) {
      console.log('createNewDatabase error', error)
      if (
        error instanceof Error &&
        error.message.includes(
          'Aborted(). Build with -sASSERTIONS for more info.',
        )
      ) {
        // This error occurs when using an outdated Obsidian installer version
        throw new PGLiteAbortedException()
      }
      throw error
    }
  }

  private async loadExistingDatabase(): Promise<PgliteDatabase | null> {
    try {
      const databaseFileExists = await this.app.vault.adapter.exists(
        this.dbPath,
      )
      if (!databaseFileExists) {
        return null
      }
      const databaseStat = await this.app.vault.adapter.stat(this.dbPath)
      if (
        databaseStat?.type === 'file' &&
        databaseStat.size > MAX_PGLITE_DATABASE_BYTES
      ) {
        throw new Error('PGlite database archive is too large')
      }
      const fileBuffer = await this.app.vault.adapter.readBinary(this.dbPath)
      if (fileBuffer.byteLength > MAX_PGLITE_DATABASE_BYTES) {
        throw new Error('PGlite database archive is too large')
      }
      const fileBlob = await decompressPGliteArchive(
        new Blob([fileBuffer], { type: 'application/x-gzip' }),
      )
      const { fsBundle, wasmModule, vectorExtensionBundlePath } =
        await this.loadPGliteResources()
      this.pgClient = await PGlite.create({
        loadDataDir: fileBlob,
        fsBundle: fsBundle,
        wasmModule: wasmModule,
        extensions: {
          vector: vectorExtensionBundlePath,
        },
      })
      return drizzle(this.pgClient)
    } catch (error) {
      console.log('loadExistingDatabase error', error)
      if (
        error instanceof Error &&
        error.message.includes(
          'Aborted(). Build with -sASSERTIONS for more info.',
        )
      ) {
        // This error occurs when using an outdated Obsidian installer version
        throw new PGLiteAbortedException()
      }
      throw error
    }
  }

  private async migrateDatabase(): Promise<boolean> {
    try {
      const appliedBefore = await this.getAppliedMigrationCount()
      // Workaround for running Drizzle migrations in a browser environment
      // This method uses an undocumented API to perform migrations
      // See: https://github.com/drizzle-team/drizzle-orm/discussions/2532#discussioncomment-10780523
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      await this.db.dialect.migrate(migrations, this.db.session, {
        migrationsTable: 'drizzle_migrations',
      })
      const appliedAfter = await this.getAppliedMigrationCount()
      return (
        appliedBefore === null ||
        appliedAfter === null ||
        appliedBefore !== appliedAfter
      )
    } catch (error) {
      console.error('Error migrating database:', error)
      throw error
    }
  }

  private async getAppliedMigrationCount(): Promise<number | null> {
    if (!this.pgClient) return null
    try {
      const result = await this.pgClient.query<{
        count: string | number
      }>('SELECT COUNT(*) AS count FROM drizzle_migrations')
      const count = Number(result.rows[0]?.count)
      return Number.isSafeInteger(count) && count >= 0 ? count : null
    } catch {
      return null
    }
  }

  async save(): Promise<void> {
    this.saveRequested = true
    if (!this.saveQueue) {
      const save = Promise.resolve().then(() => this.drainSaveRequests())
      this.saveQueue = save
      void save.then(
        () => {
          if (this.saveQueue === save) this.saveQueue = null
        },
        () => {
          if (this.saveQueue === save) this.saveQueue = null
        },
      )
    }
    return this.saveQueue
  }

  private async drainSaveRequests(): Promise<void> {
    while (this.saveRequested) {
      this.saveRequested = false
      try {
        await this.writeSnapshot()
      } catch (error) {
        this.saveRequested = true
        throw error
      }
    }
  }

  private async writeSnapshot(): Promise<void> {
    if (!this.pgClient) return
    const tarBlob: Blob = await this.pgClient.dumpDataDir('none')
    if (tarBlob.size > MAX_PGLITE_DATABASE_BYTES) {
      throw new Error('PGlite database archive is too large')
    }
    const blob = await new Response(
      tarBlob.stream().pipeThrough(new CompressionStream('gzip')),
    ).blob()
    if (blob.size > MAX_PGLITE_DATABASE_BYTES) {
      throw new Error('PGlite database archive is too large')
    }
    await writeBinaryFileAtomically(
      this.app.vault.adapter,
      this.dbPath,
      await blob.arrayBuffer(),
    )
  }

  private async flushPendingSaves(): Promise<void> {
    if (this.saveQueue) {
      await this.saveQueue
    }
    if (this.saveRequested) {
      await this.save()
    }
  }

  async cleanup() {
    let saveError: unknown
    let saveFailed = false
    try {
      await DatabaseManager.managers.get(this)?.vectorManager?.close()
      await this.flushPendingSaves()
    } catch (error) {
      saveError = error
      saveFailed = true
    }

    DatabaseManager.managers.delete(this)
    const pgClient = this.pgClient
    this.pgClient = null
    this.db = null
    try {
      await pgClient?.close()
    } catch (error) {
      if (!saveFailed) {
        throw error
      }
      console.error('Failed to close database after save failure:', error)
    }
    if (saveFailed) {
      throw saveError
    }
  }

  // TODO: This function is a temporary workaround chosen due to the difficulty of bundling postgres.wasm and postgres.data from node_modules into a single JS file. The ultimate goal is to bundle everything into one JS file in the future.
  private async loadPGliteResources(): Promise<{
    fsBundle: Blob
    wasmModule: WebAssembly.Module
    vectorExtensionBundlePath: URL
  }> {
    try {
      const loadResource = async (
        resource: keyof typeof PGLITE_RESOURCE_SHA256,
      ) => {
        const cached = await this.readCachedPGliteResource(resource)
        if (cached) return cached

        const response = await withRequestTimeout(
          requestUrl(
            `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/${resource}`,
          ),
        )
        if (response.arrayBuffer.byteLength > MAX_PGLITE_RESOURCE_BYTES) {
          throw new Error(`PGlite resource is too large: ${resource}`)
        }
        await verifySha256(
          resource,
          response.arrayBuffer,
          PGLITE_RESOURCE_SHA256[resource],
        )
        await this.cachePGliteResource(resource, response.arrayBuffer).catch(
          (error) => {
            console.warn(`Failed to cache PGlite resource ${resource}:`, error)
          },
        )
        return response.arrayBuffer
      }
      const [fsBundleBytes, wasmBytes, vectorExtensionBytes] =
        await Promise.all([
          loadResource('postgres.data'),
          loadResource('postgres.wasm'),
          loadResource('vector.tar.gz'),
        ])

      const fsBundle = new Blob([fsBundleBytes], {
        type: 'application/octet-stream',
      })
      const wasmModule = await WebAssembly.compile(wasmBytes)
      const vectorExtensionBundlePath = new URL(
        `data:application/gzip;base64,${Buffer.from(
          vectorExtensionBytes,
        ).toString('base64')}`,
      )

      return { fsBundle, wasmModule, vectorExtensionBundlePath }
    } catch (error) {
      console.error('Error loading PGlite resources:', error)
      throw error
    }
  }

  private getPGliteResourceCachePath(
    resource: keyof typeof PGLITE_RESOURCE_SHA256,
  ): { directory: string; path: string } {
    const configDir = this.app.vault.configDir || '.obsidian'
    const directory = normalizePath(
      `${configDir}/plugins/aider/.pglite-cache-${PGLITE_VERSION}`,
    )
    return {
      directory,
      path: normalizePath(
        `${directory}/${resource}-${PGLITE_RESOURCE_SHA256[resource]}`,
      ),
    }
  }

  private async readCachedPGliteResource(
    resource: keyof typeof PGLITE_RESOURCE_SHA256,
  ): Promise<ArrayBuffer | null> {
    const adapter = this.app.vault.adapter
    if (typeof adapter.readBinary !== 'function') return null
    const { path } = this.getPGliteResourceCachePath(resource)
    if (!(await adapter.exists(path))) return null

    try {
      const stat = await adapter.stat(path)
      if (stat?.type === 'file' && stat.size > MAX_PGLITE_RESOURCE_BYTES) {
        throw new Error('cached resource is too large')
      }
      const bytes = await adapter.readBinary(path)
      if (bytes.byteLength > MAX_PGLITE_RESOURCE_BYTES) {
        throw new Error('cached resource is too large')
      }
      await verifySha256(resource, bytes, PGLITE_RESOURCE_SHA256[resource])
      return bytes
    } catch {
      await adapter.remove(path).catch(() => undefined)
      return null
    }
  }

  private async cachePGliteResource(
    resource: keyof typeof PGLITE_RESOURCE_SHA256,
    bytes: ArrayBuffer,
  ): Promise<void> {
    const adapter = this.app.vault.adapter
    if (typeof adapter.writeBinary !== 'function') return
    const { directory, path } = this.getPGliteResourceCachePath(resource)
    if (!(await adapter.exists(directory))) {
      try {
        await adapter.mkdir(directory)
      } catch (error) {
        if (!(await adapter.exists(directory))) throw error
      }
    }
    await writeBinaryFileAtomically(adapter, path, bytes)
  }
}

export async function decompressPGliteArchive(
  archive: Blob,
  maxBytes = MAX_PGLITE_DATABASE_BYTES,
): Promise<Blob> {
  const stream = archive
    .stream()
    .pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('PGlite database archive expands beyond the size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return new Blob(chunks, { type: 'application/x-tar' })
}

async function verifySha256(
  resource: string,
  bytes: ArrayBuffer,
  expected: string,
): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (actual !== expected) {
    throw new Error(`PGlite resource integrity check failed: ${resource}`)
  }
}
