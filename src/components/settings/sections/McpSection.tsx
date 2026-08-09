import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleMinus,
  Edit,
  Loader2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { App, Notice } from 'obsidian'
import { useCallback, useEffect, useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import { McpManager } from '../../../core/mcp/mcpManager'
import SmartComposerPlugin from '../../../main'
import {
  McpServerState,
  McpServerStatus,
  McpTool,
} from '../../../types/mcp.types'
import { runAsyncAction } from '../../../utils/async-action'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { deleteMcpServer } from '../destructive-actions'
import {
  AddMcpServerModal,
  EditMcpServerModal,
} from '../modals/McpServerFormModal'
import { StatusBadge } from '../StatusBadge'

type McpSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function McpSection({ app, plugin }: McpSectionProps) {
  const [mcpManager, setMcpManager] = useState<McpManager | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])

  useEffect(() => {
    const initMCPManager = async () => {
      const mcpManager = await plugin.getMcpManager()
      setMcpManager(mcpManager)
      setMcpServers(mcpManager.getServers())
    }
    runAsyncAction(initMCPManager)
  }, [plugin])

  useEffect(() => {
    if (mcpManager) {
      const unsubscribe = mcpManager.subscribeServersChange((servers) => {
        setMcpServers(servers)
      })
      return () => {
        unsubscribe()
      }
    }
  }, [mcpManager])

  return (
    <div className="smtcmp-settings-section">
      <h2 className="smtcmp-settings-header">MCP (Model Context Protocol)</h2>

      <div className="smtcmp-settings-desc smtcmp-settings-callout">
        <strong>Security:</strong> A new or changed server must be reviewed on
        this device before Aider starts its command. When using tools, the tool
        response is passed to the language model (LLM). If the tool result
        contains a large amount of content, this can significantly increase LLM
        usage and associated costs. Please be mindful when enabling or using
        tools that may return long outputs.
      </div>

      {mcpManager?.disabled ? (
        <div className="smtcmp-settings-desc">
          MCP is not supported on mobile devices
        </div>
      ) : (
        <>
          <h3 className="smtcmp-settings-sub-header">MCP servers</h3>

          <div className="smtcmp-settings-table-container">
            <table className="smtcmp-settings-table">
              <colgroup>
                <col />
                <col width={128} />
                <col width={60} />
                <col width={120} />
              </colgroup>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Enable</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mcpServers.length > 0 ? (
                  mcpServers.map((server) => (
                    <McpServerRows
                      key={server.name}
                      server={server}
                      app={app}
                      plugin={plugin}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="smtcmp-settings-table-empty">
                      No MCP servers found
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <button
                      type="button"
                      onClick={() => new AddMcpServerModal(app, plugin).open()}
                    >
                      Add MCP server
                    </button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function McpServerRows({
  server,
  app,
  plugin,
}: {
  server: McpServerState
  app: App
  plugin: SmartComposerPlugin
}) {
  const { setSettings } = useSettings()
  const [isOpen, setIsOpen] = useState(false)
  const [isTrusting, setIsTrusting] = useState(false)

  const handleEdit = useCallback(() => {
    new EditMcpServerModal(app, plugin, server.name).open()
  }, [server.name, app, plugin])

  const handleDelete = useCallback(() => {
    const message = `Are you sure you want to delete MCP server "${server.name}"?`
    new ConfirmModal(app, {
      title: 'Delete MCP server',
      message: message,
      ctaText: 'Delete',
      onConfirm: async () => {
        await deleteMcpServer({ plugin, serverId: server.name, setSettings })
      },
    }).open()
  }, [server.name, setSettings, app, plugin])

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => {
      runAsyncAction(() =>
        setSettings((currentSettings) => ({
          ...currentSettings,
          mcp: {
            ...currentSettings.mcp,
            servers: currentSettings.mcp.servers.map((s) =>
              s.id === server.name ? { ...s, enabled } : s,
            ),
          },
        })),
      )
    },
    [setSettings, server.name],
  )

  const handleTrust = useCallback(async () => {
    setIsTrusting(true)
    try {
      await plugin.trustMcpServer(server.name)
      new Notice(`Trusted MCP server "${server.name}" on this device`)
    } catch {
      new Notice('Unable to save MCP server trust')
    } finally {
      setIsTrusting(false)
    }
  }, [plugin, server.name])

  return (
    <>
      <tr>
        <td>{server.name}</td>
        <td>
          <McpServerStatusBadge status={server.status} />
        </td>
        <td>
          <ObsidianToggle
            value={server.config.enabled}
            onChange={handleToggleEnabled}
            ariaLabel={`Enable MCP server ${server.name}`}
          />
        </td>
        <td>
          <div className="smtcmp-settings-actions">
            {server.status === McpServerStatus.ApprovalRequired && (
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="clickable-icon"
                aria-label="Review server command"
                title="Show the exact command, arguments, and environment"
              >
                <ShieldCheck />
              </button>
            )}
            <button
              type="button"
              onClick={handleEdit}
              className="clickable-icon"
              aria-label={`Edit MCP server ${server.name}`}
            >
              <Edit />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="clickable-icon"
              aria-label={`Delete MCP server ${server.name}`}
            >
              <Trash2 />
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="clickable-icon"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronUp /> : <ChevronDown />}
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="smtcmp-settings-table-expanded-row">
          <td colSpan={4}>
            <ExpandedServerInfo
              server={server}
              onTrust={handleTrust}
              isTrusting={isTrusting}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function ExpandedServerInfo({
  server,
  onTrust,
  isTrusting,
}: {
  server: McpServerState
  onTrust: () => Promise<void>
  isTrusting: boolean
}) {
  if (
    server.status === McpServerStatus.Disconnected ||
    server.status === McpServerStatus.Connecting
  ) {
    return null
  }

  return (
    <div className="smtcmp-server-expanded-info">
      {server.status === McpServerStatus.ApprovalRequired && (
        <div>
          <div className="smtcmp-server-expanded-info-header">
            Review required
          </div>
          <div className="smtcmp-server-error-message">
            Command: {server.config.parameters.command}
            {server.config.parameters.args?.length
              ? ` ${server.config.parameters.args.join(' ')}`
              : ''}
            {Object.keys(server.config.parameters.env ?? {}).length > 0
              ? ` · Environment names: ${Object.keys(
                  server.config.parameters.env ?? {},
                ).join(', ')}`
              : ''}
          </div>
          <button
            type="button"
            className="mod-cta"
            onClick={onTrust}
            disabled={isTrusting}
          >
            {isTrusting ? 'Trusting...' : 'Trust reviewed command'}
          </button>
        </div>
      )}
      {server.status === McpServerStatus.Connected && (
        <div>
          <div className="smtcmp-server-expanded-info-header">Tools</div>
          <div className="smtcmp-server-tools-container">
            {server.tools.map((tool) => (
              <McpToolComponent key={tool.name} tool={tool} server={server} />
            ))}
          </div>
        </div>
      )}
      {server.status === McpServerStatus.Error && (
        <div>
          <div className="smtcmp-server-expanded-info-header">Error</div>
          <div className="smtcmp-server-error-message">
            {server.error.message}
          </div>
        </div>
      )}
    </div>
  )
}

function McpServerStatusBadge({ status }: { status: McpServerStatus }) {
  const statusConfig = {
    [McpServerStatus.ApprovalRequired]: {
      icon: <ShieldCheck size={16} />,
      label: 'Review required',
      tone: 'error',
    },
    [McpServerStatus.Connected]: {
      icon: <Check size={16} />,
      label: 'Connected',
      tone: 'connected',
    },
    [McpServerStatus.Connecting]: {
      icon: <Loader2 size={16} className="spinner" />,
      label: 'Connecting...',
      tone: 'connecting',
    },
    [McpServerStatus.Error]: {
      icon: <X size={16} />,
      label: 'Error',
      tone: 'error',
    },
    [McpServerStatus.Disconnected]: {
      icon: <CircleMinus size={16} />,
      label: 'Disconnected',
      tone: 'disconnected',
    },
  } as const

  const { icon, label, tone } = statusConfig[status]

  return <StatusBadge tone={tone} icon={icon} label={label} />
}

function McpToolComponent({
  tool,
  server,
}: {
  tool: McpTool
  server: McpServerState
}) {
  const { setSettings } = useSettings()

  const toolOption = server.config.toolOptions[tool.name]
  const disabled = toolOption?.disabled ?? false
  const allowAutoExecution = toolOption?.allowAutoExecution ?? false

  const handleToggleEnabled = (enabled: boolean) => {
    runAsyncAction(() =>
      setSettings((currentSettings) => ({
        ...currentSettings,
        mcp: {
          ...currentSettings.mcp,
          servers: currentSettings.mcp.servers.map((s) =>
            s.id === server.name
              ? {
                  ...s,
                  toolOptions: {
                    ...s.toolOptions,
                    [tool.name]: {
                      disabled: !enabled,
                      allowAutoExecution:
                        s.toolOptions[tool.name]?.allowAutoExecution ?? false,
                    },
                  },
                }
              : s,
          ),
        },
      })),
    )
  }

  const handleToggleAutoExecution = (autoExecution: boolean) => {
    runAsyncAction(() =>
      setSettings((currentSettings) => ({
        ...currentSettings,
        mcp: {
          ...currentSettings.mcp,
          servers: currentSettings.mcp.servers.map((s) =>
            s.id === server.name
              ? {
                  ...s,
                  toolOptions: {
                    ...s.toolOptions,
                    [tool.name]: {
                      disabled: s.toolOptions[tool.name]?.disabled ?? false,
                      ...s.toolOptions[tool.name],
                      allowAutoExecution: autoExecution,
                    },
                  },
                }
              : s,
          ),
        },
      })),
    )
  }

  return (
    <div className="smtcmp-mcp-tool">
      <div className="smtcmp-mcp-tool-info">
        <div className="smtcmp-mcp-tool-name">{tool.name}</div>
        <div className="smtcmp-mcp-tool-description">{tool.description}</div>
      </div>
      <div className="smtcmp-mcp-tool-toggle">
        <span className="smtcmp-mcp-tool-toggle-label">Enabled</span>
        <ObsidianToggle
          value={!disabled}
          onChange={(value) => handleToggleEnabled(value)}
          ariaLabel={`Enable MCP tool ${server.name}:${tool.name}`}
        />
      </div>
      <div className="smtcmp-mcp-tool-toggle">
        <span
          className="smtcmp-mcp-tool-toggle-label"
          title="Run this tool without asking for approval each time"
        >
          Auto-run (no approval)
        </span>
        <ObsidianToggle
          value={allowAutoExecution}
          onChange={(value) => handleToggleAutoExecution(value)}
          ariaLabel={`Allow MCP tool ${server.name}:${tool.name} without approval`}
        />
      </div>
    </div>
  )
}
