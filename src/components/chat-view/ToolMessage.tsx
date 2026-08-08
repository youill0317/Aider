import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { Notice } from 'obsidian'
import { memo, useCallback, useMemo, useState } from 'react'

import { useSettings } from '../../contexts/settings-context'
import { useToolDispatcher } from '../../contexts/tool-dispatcher-context'
import { CODEX_TOOL_NAME } from '../../core/agent/CodexToolRunner'
import { InvalidToolNameException } from '../../core/mcp/exception'
import { parseToolName } from '../../core/mcp/tool-name-utils'
import { ChatToolMessage } from '../../types/chat'
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import { redactSecrets } from '../../utils/security/redact-secrets'
import { SplitButton } from '../common/SplitButton'

import { ObsidianCodeBlock } from './ObsidianMarkdown'

const STATUS_LABELS: Record<ToolCallResponseStatus, string> = {
  [ToolCallResponseStatus.PendingApproval]: 'Call',
  [ToolCallResponseStatus.Rejected]: 'Rejected',
  [ToolCallResponseStatus.Running]: 'Running',
  [ToolCallResponseStatus.Success]: 'Called',
  [ToolCallResponseStatus.Error]: 'Failed',
  [ToolCallResponseStatus.Aborted]: 'Aborted',
}

export const getToolMessageContent = (message: ChatToolMessage): string => {
  return message.toolCalls
    ?.map((toolCall) => {
      const { serverName, toolName } = (() => {
        try {
          return parseToolName(toolCall.request.name)
        } catch (error) {
          if (error instanceof InvalidToolNameException) {
            return { serverName: null, toolName: toolCall.request.name }
          }
          throw error
        }
      })()
      return [
        `${STATUS_LABELS[toolCall.response.status]} ${
          toolCall.request.name === CODEX_TOOL_NAME
            ? '>_'
            : serverName
              ? `${serverName}:${toolName}`
              : toolName
        }`,
        ...(toolCall.request.arguments
          ? [`Parameters: ${toolCall.request.arguments}`]
          : []),
      ].join('\n')
    })
    .join('\n')
}

export type ExecuteApprovedToolCall = (
  request: ToolCallRequest,
  onResponseUpdate: (response: ToolCallResponse) => void,
) => Promise<void>

export type AbortApprovedToolCall = (
  toolCallId: string,
  onlyIfActive?: boolean,
) => void

export type ToolCallResponseUpdater = (
  messageId: string,
  toolCallId: string,
  response: ToolCallResponse,
) => void

export type ToolApprovalAction =
  | 'allow'
  | 'allow-for-conversation'
  | 'reject'
  | 'cancel'

export type ToolApprovalActionAdapter = (
  action: ToolApprovalAction,
  request: ToolCallRequest,
) => void

export function runToolApprovalAction(
  adapter: ToolApprovalActionAdapter | undefined,
  action: ToolApprovalAction,
  request: ToolCallRequest,
  fallback: () => void | Promise<void>,
): void | Promise<void> {
  return adapter ? adapter(action, request) : fallback()
}

const ToolMessage = memo(function ToolMessage({
  message,
  conversationId,
  executeToolCall,
  abortToolCall,
  onToolCallResponseUpdate,
  approvalActionAdapter,
  approvalActions,
}: {
  message: ChatToolMessage
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  onToolCallResponseUpdate: ToolCallResponseUpdater
  approvalActionAdapter?: ToolApprovalActionAdapter
  approvalActions?: readonly ToolApprovalAction[]
}) {
  return (
    <div className="smtcmp-toolcall-container">
      {message.toolCalls.map((toolCall, index) => (
        <div
          key={toolCall.request.id}
          className={clsx(index > 0 && 'smtcmp-toolcall-border-top')}
        >
          <ToolCallItem
            request={toolCall.request}
            response={toolCall.response}
            conversationId={conversationId}
            executeToolCall={executeToolCall}
            abortToolCall={abortToolCall}
            approvalActionAdapter={approvalActionAdapter}
            approvalActions={approvalActions}
            onResponseUpdate={(response) =>
              onToolCallResponseUpdate(
                message.id,
                toolCall.request.id,
                response,
              )
            }
          />
        </div>
      ))}
    </div>
  )
})

function ToolCallItem({
  request,
  response,
  conversationId,
  executeToolCall,
  abortToolCall,
  approvalActionAdapter,
  approvalActions,
  onResponseUpdate,
}: {
  request: ToolCallRequest
  response: ToolCallResponse
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  approvalActionAdapter?: ToolApprovalActionAdapter
  approvalActions?: readonly ToolApprovalAction[]
  onResponseUpdate: (response: ToolCallResponse) => void
}) {
  const {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleReject,
    handleAbort,
  } = useToolCall(
    request,
    conversationId,
    executeToolCall,
    abortToolCall,
    onResponseUpdate,
  )
  const isCodexTool = request.name === CODEX_TOOL_NAME

  const [isOpen, setIsOpen] = useState(
    // Open by default if the tool call requires approval
    response.status === ToolCallResponseStatus.PendingApproval,
  )

  const { serverName, toolName } = useMemo(() => {
    try {
      return parseToolName(request.name)
    } catch (error) {
      if (error instanceof InvalidToolNameException) {
        return {
          serverName: null,
          toolName: request.name,
        }
      }
      throw error
    }
  }, [request.name])
  const parameters = useMemo(() => {
    if (!request.arguments) {
      return 'No parameters'
    }
    try {
      return JSON.stringify(JSON.parse(request.arguments), null, 2)
    } catch (error) {
      return request.arguments
    }
  }, [request.arguments])
  const runApprovalAction = (
    action: ToolApprovalAction,
    fallback: () => void | Promise<void>,
  ) => runToolApprovalAction(approvalActionAdapter, action, request, fallback)
  const actionAllowed = (action: ToolApprovalAction) =>
    approvalActions === undefined || approvalActions.includes(action)
  const approveToolCall = (
    action: ToolApprovalAction,
    savePermission?: () => Promise<void>,
  ) => {
    void (async () => {
      await runApprovalAction(action, async () => {
        await savePermission?.()
        await handleToolCall()
      })
      setIsOpen(false)
    })().catch((error) => {
      new Notice('Unable to approve tool call')
      console.error('Unable to approve tool call', redactSecrets(error))
    })
  }

  return (
    <div className="smtcmp-toolcall">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="smtcmp-toolcall-header"
        aria-expanded={isOpen}
      >
        <div className="smtcmp-toolcall-header-icon">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="smtcmp-toolcall-header-content">
          <span>{STATUS_LABELS[response.status] || 'Unknown'}</span>
          <span>&nbsp;&nbsp;</span>
          <span className="smtcmp-toolcall-header-tool-name">
            {isCodexTool
              ? '>_'
              : serverName
                ? `${serverName}:${toolName}`
                : toolName}
          </span>
        </div>
        <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
          <StatusIcon status={response.status} />
        </div>
      </button>
      {isOpen && (
        <div className="smtcmp-toolcall-content">
          <div className="smtcmp-toolcall-content-section">
            <div>Parameters:</div>
            <ObsidianCodeBlock language="json" content={parameters} />
          </div>
          {response.status === ToolCallResponseStatus.Success && (
            <div className="smtcmp-toolcall-content-section">
              <div>Result:</div>
              <ObsidianCodeBlock content={response.data.text} />
            </div>
          )}
          {response.status === ToolCallResponseStatus.Error && (
            <div className="smtcmp-toolcall-content-section">
              <div>Error:</div>
              <ObsidianCodeBlock content={response.error} />
            </div>
          )}
        </div>
      )}
      {(response.status === ToolCallResponseStatus.PendingApproval ||
        response.status === ToolCallResponseStatus.Running) && (
        <div className="smtcmp-toolcall-footer">
          {response.status === ToolCallResponseStatus.PendingApproval && (
            <div className="smtcmp-toolcall-footer-actions">
              {(actionAllowed('allow') ||
                actionAllowed('allow-for-conversation')) && (
                <SplitButton
                  primaryText={
                    actionAllowed('allow') ? 'Allow' : 'Allow for this chat'
                  }
                  onPrimaryClick={() =>
                    actionAllowed('allow')
                      ? approveToolCall('allow')
                      : approveToolCall(
                          'allow-for-conversation',
                          handleAllowForConversation,
                        )
                  }
                  menuOptions={
                    actionAllowed('allow') &&
                    actionAllowed('allow-for-conversation')
                      ? isCodexTool
                        ? [
                            {
                              label: 'Allow for this chat',
                              onClick: () =>
                                approveToolCall(
                                  'allow-for-conversation',
                                  handleAllowForConversation,
                                ),
                            },
                          ]
                        : [
                            {
                              label: 'Always allow this tool',
                              onClick: () =>
                                approveToolCall(
                                  'allow',
                                  handleAllowAutoExecution,
                                ),
                            },
                            {
                              label: 'Allow for this chat',
                              onClick: () =>
                                approveToolCall(
                                  'allow-for-conversation',
                                  handleAllowForConversation,
                                ),
                            },
                          ]
                      : []
                  }
                />
              )}
              {actionAllowed('reject') && (
                <button
                  type="button"
                  title="Refuse the tool and tell the model, then continue the conversation."
                  onClick={() => {
                    runApprovalAction('reject', handleReject)
                    setIsOpen(false)
                  }}
                >
                  Reject
                </button>
              )}
              {actionAllowed('cancel') && (
                <button
                  type="button"
                  title="Stop the current turn."
                  onClick={() => {
                    runApprovalAction('cancel', handleAbort)
                    setIsOpen(false)
                  }}
                >
                  Abort
                </button>
              )}
            </div>
          )}
          {response.status === ToolCallResponseStatus.Running && (
            <div className="smtcmp-toolcall-footer-actions">
              <button
                type="button"
                onClick={() => runApprovalAction('cancel', handleAbort)}
              >
                Abort
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function useToolCall(
  request: ToolCallRequest,
  conversationId: string,
  executeToolCall: ExecuteApprovedToolCall,
  abortToolCall: AbortApprovedToolCall,
  onResponseUpdate: (response: ToolCallResponse) => void,
) {
  const { setSettings } = useSettings()
  const { getToolDispatcher } = useToolDispatcher()

  const handleToolCall = useCallback(async () => {
    await executeToolCall(request, onResponseUpdate)
  }, [executeToolCall, request, onResponseUpdate])

  const handleAllowForConversation = useCallback(async () => {
    const toolDispatcher = await getToolDispatcher()
    toolDispatcher.allowToolForConversation(
      request.name,
      request.arguments,
      conversationId,
    )
  }, [request, conversationId, getToolDispatcher])

  const handleAllowAutoExecution = useCallback(async () => {
    const { serverName, toolName } = parseToolName(request.name)
    await setSettings((currentSettings) => {
      if (!currentSettings.mcp.servers.some((s) => s.id === serverName)) {
        throw new Error(`Server ${serverName} not found`)
      }
      return {
        ...currentSettings,
        mcp: {
          ...currentSettings.mcp,
          servers: currentSettings.mcp.servers.map((server) =>
            server.id === serverName
              ? {
                  ...server,
                  toolOptions: {
                    ...server.toolOptions,
                    [toolName]: {
                      disabled: false,
                      ...server.toolOptions[toolName],
                      allowAutoExecution: true,
                    },
                  },
                }
              : server,
          ),
        },
      }
    })
  }, [request, setSettings])

  const handleReject = useCallback(() => {
    abortToolCall(request.id, true)
    onResponseUpdate({
      status: ToolCallResponseStatus.Rejected,
    })
  }, [abortToolCall, onResponseUpdate, request.id])

  const handleAbort = useCallback(() => {
    abortToolCall(request.id)
    onResponseUpdate({
      status: ToolCallResponseStatus.Aborted,
    })
  }, [abortToolCall, onResponseUpdate, request.id])

  return {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleReject,
    handleAbort,
  }
}

function StatusIcon({ status }: { status: ToolCallResponseStatus }) {
  switch (status) {
    case ToolCallResponseStatus.PendingApproval:
      return null
    case ToolCallResponseStatus.Rejected:
    case ToolCallResponseStatus.Aborted:
    case ToolCallResponseStatus.Error:
      return <X size={16} style={{ color: 'var(--text-error)' }} />
    case ToolCallResponseStatus.Running:
      return <Loader2 size={16} className="spinner" />
    case ToolCallResponseStatus.Success:
      return <Check size={16} style={{ color: 'var(--text-success)' }} />
    default:
      return null
  }
}

export default ToolMessage
