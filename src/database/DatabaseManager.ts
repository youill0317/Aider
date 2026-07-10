import { PGlite } from '@electric-sql/pglite'
import { PgliteDatabase, drizzle } from 'drizzle-orm/pglite'
import { App, normalizePath, requestUrl } from 'obsidian'

import { PGLITE_DB_PATH } from '../constants'

import { PGLiteAbortedException } from './exception'
import migrations from './migrations.json'
import { LegacyTemplateManager } from './modules/template/TemplateManager'
import { VectorManager } from './modules/vector/VectorManager'

const PGLITE_VERSION = '0.2.12'
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
  private saveQueue: Promise<void> = Promise.resolve()
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
    dbManager.db = await dbManager.loadExistingDatabase()
    if (!dbManager.db) {
      dbManager.db = await dbManager.createNewDatabase()
    }
    await dbManager.migrateDatabase()
    await dbManager.save()

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
      const fileBuffer = await this.app.vault.adapter.readBinary(this.dbPath)
      const fileBlob = new Blob([fileBuffer], { type: 'application/x-gzip' })
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

  private async migrateDatabase(): Promise<void> {
    try {
      // Workaround for running Drizzle migrations in a browser environment
      // This method uses an undocumented API to perform migrations
      // See: https://github.com/drizzle-team/drizzle-orm/discussions/2532#discussioncomment-10780523
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      await this.db.dialect.migrate(migrations, this.db.session, {
        migrationsTable: 'drizzle_migrations',
      })
    } catch (error) {
      console.error('Error migrating database:', error)
      throw error
    }
  }

  async save(): Promise<void> {
    const save = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.pgClient) {
          return
        }
        const blob: Blob = await this.pgClient.dumpDataDir('gzip')
        await this.app.vault.adapter.writeBinary(
          this.dbPath,
          Buffer.from(await blob.arrayBuffer()),
        )
      })
    this.saveQueue = save
    return save
  }

  async cleanup() {
    let saveError: unknown
    let saveFailed = false
    try {
      await this.save()
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
        const response = await requestUrl(
          `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/${resource}`,
        )
        await verifySha256(
          resource,
          response.arrayBuffer,
          PGLITE_RESOURCE_SHA256[resource],
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
