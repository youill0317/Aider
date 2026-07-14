import { Editor, MarkdownView, Notice, Plugin } from 'obsidian'

import {
  adoptAiderStorage,
  summarizeAdoptionError,
} from './adoption/aiderStorageAdoption'
import { loadAiderMigrationWiring } from './aiderMigrationWiring'
import { ApplyView } from './ApplyView'
import { ChatView } from './ChatView'
import type { ChatProps } from './components/chat-view/Chat'
import { InstallerUpdateRequiredModal } from './components/modals/InstallerUpdateRequiredModal'
import { CHAT_VIEW_TYPE } from './constants'
import { CodexToolRunner } from './core/agent/CodexToolRunner'
import { McpManager } from './core/mcp/mcpManager'
import { RAGEngine } from './core/rag/ragEngine'
import { DatabaseManager } from './database/DatabaseManager'
import { PGLiteAbortedException } from './database/exception'
import { migrateToJsonDatabase } from './database/json/migrateToJsonDatabase'
import {
  isMcpServerTrusted,
  revokeMcpServerTrust,
  revokeProviderRouteTrust,
  trustMcpServer,
  trustProviderRoute,
} from './security/config-trust'
import {
  SecretStore,
  createSecretStore,
} from './security/secret-store/secret-store'
import {
  hydrateSettingsSecrets,
  persistRecognizedRawSettingsSecrets,
  persistSettingsUpdate,
  sanitizeSettingsForPersistence,
} from './security/secret-store/settings-secrets'
import {
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './settings/schema/setting.types'
import { parseSmartComposerSettingsResult } from './settings/schema/settings'
import { SmartComposerSettingTab } from './settings/SettingTab'
import {
  ToolDispatcher,
  createToolDispatcher,
} from './utils/chat/tool-dispatcher'
import { getMentionableBlockData } from './utils/obsidian'

export default class SmartComposerPlugin extends Plugin {
  settings: SmartComposerSettings
  initialChatProps?: ChatProps // TODO: change this to use view state like ApplyView
  settingsChangeListeners: ((newSettings: SmartComposerSettings) => void)[] = []
  codexToolRunner: CodexToolRunner | null = null
  toolDispatcher: ToolDispatcher | null = null
  mcpManager: McpManager | null = null
  dbManager: DatabaseManager | null = null
  ragEngine: RAGEngine | null = null
  private dbManagerInitPromise: Promise<DatabaseManager> | null = null
  private ragEngineInitPromise: Promise<RAGEngine> | null = null
  private mcpManagerInitPromise: Promise<McpManager> | null = null
  private secretStore: SecretStore | null = null
  private settingsSaveQueue: Promise<void> | null = null
  private timeoutIds: ReturnType<typeof setTimeout>[] = [] // Use ReturnType instead of number
  private unloading = false

  async onload() {
    this.unloading = false
    await loadAiderMigrationWiring(
      {
        adoptSmartComposerData: () => this.adoptSmartComposerData(),
        loadSettings: () => this.loadSettings(),
        registerView: (type, viewCreator) =>
          this.registerView(type, viewCreator),
      },
      {
        applyView: (leaf) => new ApplyView(leaf),
        chatView: (leaf) => new ChatView(leaf, this),
      },
    )

    // This creates an icon in the left ribbon.
    this.addRibbonIcon('wand-sparkles', 'Open Aider', () => this.openChatView())

    // This adds a simple command that can be triggered anywhere
    this.addCommand({
      id: 'open-new-chat',
      name: 'Open chat',
      callback: () => this.openChatView(true),
    })

    this.addCommand({
      id: 'add-selection-to-chat',
      name: 'Add selection to chat',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.addSelectionToChat(editor, view)
      },
    })

    this.addCommand({
      id: 'rebuild-vault-index',
      name: 'Rebuild entire vault index',
      callback: async () => {
        const notice = new Notice('Rebuilding vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: true },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Rebuilding vault index complete')
        } catch (error) {
          console.error(error)
          notice.setMessage('Rebuilding vault index failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    this.addCommand({
      id: 'update-vault-index',
      name: 'Update index for modified files',
      callback: async () => {
        const notice = new Notice('Updating vault index...', 0)
        try {
          const ragEngine = await this.getRAGEngine()
          await ragEngine.updateVaultIndex(
            { reindexAll: false },
            (queryProgress) => {
              if (queryProgress.type === 'indexing') {
                const { completedChunks, totalChunks } =
                  queryProgress.indexProgress
                notice.setMessage(
                  `Indexing chunks: ${completedChunks} / ${totalChunks}${
                    queryProgress.indexProgress.waitingForRateLimit
                      ? '\n(waiting for rate limit to reset)'
                      : ''
                  }`,
                )
              }
            },
          )
          notice.setMessage('Vault index updated')
        } catch (error) {
          console.error(error)
          notice.setMessage('Vault index update failed')
        } finally {
          this.registerTimeout(() => {
            notice.hide()
          }, 1000)
        }
      },
    })

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SmartComposerSettingTab(this.app, this))

    void this.migrateToJsonStorage()
  }

  onunload() {
    this.unloading = true
    // clear all timers
    this.timeoutIds.forEach((id) => clearTimeout(id))
    this.timeoutIds = []

    // Finish queued RAG work before closing its database.
    const ragEngine = this.ragEngine
    const dbManager = this.dbManager
    this.ragEngine = null

    // Promise cleanup
    this.dbManagerInitPromise = null
    this.ragEngineInitPromise = null
    this.mcpManagerInitPromise = null

    this.dbManager = null
    void (async () => {
      await ragEngine?.cleanup()
      await dbManager?.cleanup()
    })().catch(() => {
      console.error('Failed to close the Aider database cleanly')
    })

    // McpManager cleanup
    this.mcpManager?.cleanup()
    this.mcpManager = null

    this.codexToolRunner?.cleanup()
    this.codexToolRunner = null
    this.toolDispatcher = null
  }

  async loadSettings() {
    const rawData = await this.loadData()
    const { settings: parsedSettings, safeToPersist } =
      parseSmartComposerSettingsResult(rawData)
    const secretStore = this.getSecretStore()
    this.settings = await hydrateSettingsSecrets(parsedSettings, secretStore)
    if (safeToPersist) {
      await this.saveData(
        await sanitizeSettingsForPersistence(this.settings, secretStore),
      ) // Save updated settings
    } else {
      await persistRecognizedRawSettingsSecrets({
        rawData,
        secretStore,
        saveData: (settings) => this.saveData(settings),
      })
    }
  }

  async setSettings(newSettings: SmartComposerSettings) {
    const validationResult = smartComposerSettingsSchema.safeParse(newSettings)

    if (!validationResult.success) {
      new Notice(`Invalid settings:
${validationResult.error.issues.map((v) => v.message).join('\n')}`)
      return
    }
    const validatedSettings = validationResult.data
    const previousSave = this.settingsSaveQueue
    const save = (previousSave ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.persistSettingsUpdate(validatedSettings))
    this.settingsSaveQueue = save
    try {
      await save
    } finally {
      if (this.settingsSaveQueue === save) {
        this.settingsSaveQueue = null
      }
    }
  }

  private async persistSettingsUpdate(
    nextSettings: SmartComposerSettings,
  ): Promise<void> {
    const previousSettings = this.settings
    const secretStore = this.getSecretStore()
    await persistSettingsUpdate({
      previousSettings,
      nextSettings,
      secretStore,
      publishRuntimeSettings: (settings) => {
        this.settings = settings
      },
      saveData: (settings) => this.saveData(settings),
    })
    this.ragEngine?.setSettings(nextSettings)
    this.settingsChangeListeners.forEach((listener) => listener(nextSettings))
  }

  private getSecretStore(): SecretStore {
    if (!this.secretStore) {
      this.secretStore = createSecretStore({ app: this.app })
    }

    return this.secretStore
  }

  addSettingsChangeListener(
    listener: (newSettings: SmartComposerSettings) => void,
  ) {
    this.settingsChangeListeners.push(listener)
    return () => {
      this.settingsChangeListeners = this.settingsChangeListeners.filter(
        (l) => l !== listener,
      )
    }
  }

  async openChatView(openNewChat = false) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const editor = view?.editor
    if (!view || !editor) {
      this.activateChatView(undefined, openNewChat)
      return
    }
    const selectedBlockData = await getMentionableBlockData(editor, view)
    this.activateChatView(
      {
        selectedBlock: selectedBlockData ?? undefined,
      },
      openNewChat,
    )
  }

  async activateChatView(chatProps?: ChatProps, openNewChat = false) {
    // chatProps is consumed in ChatView.tsx
    this.initialChatProps = chatProps

    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]

    await (leaf ?? this.app.workspace.getRightLeaf(false))?.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    })

    if (openNewChat && leaf && leaf.view instanceof ChatView) {
      leaf.view.openNewChat(chatProps?.selectedBlock)
    }

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0],
    )
  }

  async addSelectionToChat(editor: Editor, view: MarkdownView) {
    const data = await getMentionableBlockData(editor, view)
    if (!data) return

    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      await this.activateChatView({
        selectedBlock: data,
      })
      return
    }

    // bring leaf to foreground (uncollapse sidebar if it's collapsed)
    await this.app.workspace.revealLeaf(leaves[0])

    const chatView = leaves[0].view
    chatView.addSelectionToChat(data)
    chatView.focusMessage()
  }

  async getDbManager(): Promise<DatabaseManager> {
    this.assertLoaded()
    if (this.dbManager) {
      return this.dbManager
    }

    if (!this.dbManagerInitPromise) {
      this.dbManagerInitPromise = (async () => {
        try {
          const manager = await DatabaseManager.create(this.app)
          if (this.unloading) {
            await manager.cleanup()
            throw new Error('Aider unloaded during database initialization')
          }
          this.dbManager = manager
          return manager
        } catch (error) {
          this.dbManagerInitPromise = null
          if (error instanceof PGLiteAbortedException) {
            new InstallerUpdateRequiredModal(this.app).open()
          }
          throw error
        }
      })()
    }

    // if initialization is running, wait for it to complete instead of creating a new initialization promise
    return this.dbManagerInitPromise
  }

  async getRAGEngine(): Promise<RAGEngine> {
    this.assertLoaded()
    if (this.ragEngine) {
      return this.ragEngine
    }

    if (!this.ragEngineInitPromise) {
      this.ragEngineInitPromise = (async () => {
        try {
          const dbManager = await this.getDbManager()
          const ragEngine = new RAGEngine(
            this.settings,
            dbManager.getVectorManager(),
          )
          if (this.unloading) {
            await ragEngine.cleanup()
            throw new Error('Aider unloaded during RAG initialization')
          }
          this.ragEngine = ragEngine
          return ragEngine
        } catch (error) {
          this.ragEngineInitPromise = null
          throw error
        }
      })()
    }

    return this.ragEngineInitPromise
  }

  async getMcpManager(): Promise<McpManager> {
    this.assertLoaded()
    if (this.mcpManager) {
      return this.mcpManager
    }

    if (!this.mcpManagerInitPromise) {
      this.mcpManagerInitPromise = (async () => {
        const manager = new McpManager({
          settings: this.settings,
          registerSettingsListener: (
            listener: (settings: SmartComposerSettings) => void,
          ) => this.addSettingsChangeListener(listener),
          isServerTrusted: (config) =>
            isMcpServerTrusted(config, this.getSecretStore()),
        })
        try {
          await manager.initialize()
          if (this.unloading) {
            throw new Error('Aider unloaded during MCP initialization')
          }
          this.mcpManager = manager
          return manager
        } catch (error) {
          manager.cleanup()
          this.mcpManagerInitPromise = null
          throw error
        }
      })()
    }

    return this.mcpManagerInitPromise
  }

  async trustMcpServer(serverId: string): Promise<void> {
    const config = this.settings.mcp.servers.find(
      (server) => server.id === serverId,
    )
    if (!config) throw new Error(`MCP server ${serverId} not found`)
    await trustMcpServer(config, this.getSecretStore())
    if (this.mcpManager) {
      await this.mcpManager.handleSettingsUpdate(this.settings)
    }
  }

  async revokeMcpServerTrust(serverId: string): Promise<void> {
    await revokeMcpServerTrust(serverId, this.getSecretStore())
  }

  async trustProviderRoute(
    provider: SmartComposerSettings['providers'][number],
  ): Promise<void> {
    await trustProviderRoute(provider, this.getSecretStore())
  }

  async revokeProviderRouteTrust(
    provider: SmartComposerSettings['providers'][number],
  ): Promise<void> {
    await revokeProviderRouteTrust(provider, this.getSecretStore())
  }

  getCodexToolRunner(): CodexToolRunner {
    this.assertLoaded()
    if (this.codexToolRunner) {
      return this.codexToolRunner
    }

    this.codexToolRunner = new CodexToolRunner({
      app: this.app,
      settings: this.settings,
      registerSettingsListener: (
        listener: (settings: SmartComposerSettings) => void,
      ) => this.addSettingsChangeListener(listener),
    })
    return this.codexToolRunner
  }

  async getToolDispatcher(): Promise<ToolDispatcher> {
    this.assertLoaded()
    if (this.toolDispatcher) {
      return this.toolDispatcher
    }

    this.toolDispatcher = createToolDispatcher({
      mcpManager: await this.getMcpManager(),
      codexToolRunner: this.getCodexToolRunner(),
    })
    return this.toolDispatcher
  }

  private assertLoaded(): void {
    if (this.unloading) {
      throw new Error('Aider is unloading')
    }
  }

  private registerTimeout(callback: () => void, timeout: number): void {
    const timeoutId = setTimeout(callback, timeout)
    this.timeoutIds.push(timeoutId)
  }

  private async adoptSmartComposerData() {
    try {
      const marker = await adoptAiderStorage(this.app)
      if (
        Object.entries(marker.resources).some(
          ([resource, status]) =>
            resource !== 'secrets' && status?.status === 'failed',
        )
      ) {
        throw new Error('Aider storage adoption is incomplete')
      }
    } catch (error) {
      const summary = summarizeAdoptionError(error)
      console.error('Failed to adopt Smart Composer data into Aider:', summary)
      new Notice(
        'Aider could not automatically adopt Smart Composer data. Existing Aider data was left unchanged.',
      )
      throw new Error(summary)
    }
  }

  private async migrateToJsonStorage() {
    try {
      await migrateToJsonDatabase(
        this.app,
        () => this.getDbManager(),
        async () => {
          if (this.unloading) return
          await this.reloadChatView()
          console.log('Migration to JSON storage completed successfully')
        },
      )
    } catch (error) {
      if (this.unloading) return
      console.error('Failed to migrate to JSON storage:', error)
      new Notice(
        'Failed to migrate to JSON storage. Please check the console for details.',
      )
    }
  }

  private async reloadChatView() {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)
    if (leaves.length === 0 || !(leaves[0].view instanceof ChatView)) {
      return
    }
    new Notice('Reloading Aider due to migration', 1000)
    leaves[0].detach()
    await this.activateChatView()
  }
}
