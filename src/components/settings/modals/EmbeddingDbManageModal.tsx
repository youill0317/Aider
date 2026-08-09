import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { Loader2, PickaxeIcon, RefreshCw, Trash2 } from 'lucide-react'
import { App, Notice } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { AppProvider } from '../../../contexts/app-context'
import {
  DatabaseProvider,
  useDatabase,
} from '../../../contexts/database-context'
import {
  SettingsProvider,
  useSettings,
} from '../../../contexts/settings-context'
import { getEmbeddingModelClient } from '../../../core/rag/embedding'
import SmartComposerPlugin from '../../../main'
import { EmbeddingDbStats } from '../../../types/embedding'
import { IndexProgress } from '../../chat-view/QueryProgress'
import { ReactModal } from '../../common/ReactModal'
import { ConfirmModal } from '../../modals/ConfirmModal'

import { rebuildEmbeddingIndex } from './rebuild-embedding-index'

type EmbeddingDbManagerModalComponentWrapperProps = {
  app: App
  plugin: SmartComposerPlugin
}

export class EmbeddingDbManageModal extends ReactModal<EmbeddingDbManagerModalComponentWrapperProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app: app,
      Component: EmbeddingDbManagerModalComponentWrapper,
      props: { app, plugin },
      options: {
        title: 'Manage embedding database',
      },
    })
    this.modalEl.style.width = '720px'
  }
}

function EmbeddingDbManagerModalComponentWrapper({
  app,
  plugin,
}: EmbeddingDbManagerModalComponentWrapperProps) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0, // Immediately garbage collect queries. It prevents memory leak on ChatView close.
      },
      mutations: {
        gcTime: 0, // Immediately garbage collect mutations. It prevents memory leak on ChatView close.
      },
    },
  })

  return (
    <AppProvider app={app}>
      <SettingsProvider
        settings={plugin.settings}
        setSettings={(newSettings) => plugin.setSettings(newSettings)}
        getSettings={() => plugin.settings}
        addSettingsChangeListener={(listener) =>
          plugin.addSettingsChangeListener(listener)
        }
      >
        <DatabaseProvider getDatabaseManager={() => plugin.getDbManager()}>
          <QueryClientProvider client={queryClient}>
            <EmbeddingDbManageModalComponent app={app} />
          </QueryClientProvider>
        </DatabaseProvider>
      </SettingsProvider>
    </AppProvider>
  )
}

function EmbeddingDbManageModalComponent({ app }: { app: App }) {
  const { getVectorManager } = useDatabase()
  const { settings } = useSettings()
  const [indexProgressMap, setIndexProgressMap] = useState<
    Map<string, IndexProgress>
  >(new Map())
  const [removingModelIds, setRemovingModelIds] = useState<Set<string>>(
    new Set(),
  )
  const [removeErrorMap, setRemoveErrorMap] = useState<Map<string, string>>(
    new Map(),
  )
  const rebuildControllersRef = useRef(new Map<string, AbortController>())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const rebuildControllers = rebuildControllersRef.current
    return () => {
      mountedRef.current = false
      rebuildControllers.forEach((controller) => controller.abort())
      rebuildControllers.clear()
    }
  }, [])

  const {
    data: stats = [],
    isLoading,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery<EmbeddingDbStats[]>({
    queryKey: ['embedding-db-stats'],
    queryFn: async () => {
      const dbStats = await (await getVectorManager()).getEmbeddingStats()

      const statsMap = new Map(dbStats.map((stat) => [stat.model, stat]))

      return settings.embeddingModels.map((embeddingModel) => ({
        model: embeddingModel.id,
        rowCount: statsMap.get(embeddingModel.id)?.rowCount ?? 0,
        totalDataBytes: statsMap.get(embeddingModel.id)?.totalDataBytes ?? 0,
      }))
    },
  })

  const handleRebuildIndex = (modelId: string) =>
    rebuildEmbeddingIndex({
      controllers: rebuildControllersRef.current,
      getEmbeddingModel: () =>
        getEmbeddingModelClient({ settings, embeddingModelId: modelId }),
      getVectorManager,
      isMounted: () => mountedRef.current,
      modelId,
      onError: (error) => {
        console.error(error)
        new Notice('Failed to rebuild index')
      },
      ragOptions: settings.ragOptions,
      refetch,
      setProgress: (id, progress) =>
        setIndexProgressMap((prev) => {
          const newMap = new Map(prev)
          if (progress) newMap.set(id, progress)
          else newMap.delete(id)
          return newMap
        }),
    })

  const handleRemoveIndex = async (modelId: string) => {
    setRemovingModelIds((current) => new Set(current).add(modelId))
    setRemoveErrorMap((current) => {
      const next = new Map(current)
      next.delete(modelId)
      return next
    })
    try {
      await (await getVectorManager()).clearAllVectors(modelId)
      await refetch()
    } catch (error) {
      console.error(error)
      const message = 'Failed to remove index'
      setRemoveErrorMap((current) => new Map(current).set(modelId, message))
      throw new Error(message)
    } finally {
      setRemovingModelIds((current) => {
        const next = new Set(current)
        next.delete(modelId)
        return next
      })
    }
  }

  const requestRemoveIndex = (modelId: string) => {
    new ConfirmModal(app, {
      title: 'Remove embedding index',
      message: `Remove all embeddings generated by "${modelId}"? This cannot be undone.`,
      ctaText: 'Remove',
      onConfirm: () => handleRemoveIndex(modelId),
    }).open()
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div className="smtcmp-settings-embedding-db-manage-root">
      <div className="smtcmp-settings-embedding-db-manage-header">
        <button
          className="clickable-icon"
          aria-label="Refresh"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={16} className={clsx(isFetching && 'spinner')} />
        </button>

        <span className="smtcmp-settings-embedding-db-manage-last-updated">
          Last updated: {dayjs(dataUpdatedAt).format('YYYY-MM-DD HH:mm:ss')}
        </span>
      </div>
      <table className="smtcmp-settings-embedding-db-manage-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Total embeddings</th>
            <th>Size (MB)</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => {
            const indexProgress = indexProgressMap.get(stat.model)
            const isRemoving = removingModelIds.has(stat.model)
            const error = removeErrorMap.get(stat.model)

            return (
              <tr key={stat.model}>
                <td>{stat.model}</td>
                <td>{stat.rowCount}</td>
                <td>{(stat.totalDataBytes / 1000 / 1000).toFixed(2)}</td>
                {indexProgress || isRemoving ? (
                  <td className="smtcmp-settings-embedding-db-manage-actions-loading">
                    <Loader2 className="spinner" size={14} />
                    <div>
                      {isRemoving
                        ? 'Removing...'
                        : `${Math.round(
                            ((indexProgress?.completedChunks ?? 0) /
                              (indexProgress?.totalChunks ?? 1)) *
                              100,
                          )}%`}
                    </div>
                  </td>
                ) : (
                  <td className="smtcmp-settings-embedding-db-manage-actions">
                    <button
                      type="button"
                      className="clickable-icon"
                      aria-label="Rebuild index"
                      onClick={() => handleRebuildIndex(stat.model)}
                    >
                      <PickaxeIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="clickable-icon"
                      aria-label="Remove index"
                      onClick={() => requestRemoveIndex(stat.model)}
                    >
                      <Trash2 size={16} />
                    </button>
                    {error && (
                      <div role="alert" style={{ color: 'var(--text-error)' }}>
                        {error}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
