import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
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

const ToolMessage = memo(function ToolMessage({
  message,
  conversationId,
  executeToolCall,
  abortToolCall,
  onToolCallResponseUpdate,
}: {
  message: ChatToolMessage
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  onToolCallResponseUpdate: ToolCallResponseUpdater
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
  onResponseUpdate,
}: {
  request: ToolCallRequest
  response: ToolCallResponse
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
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

  return (
    <div className="smtcmp-toolcall">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="smtcmp-toolcall-header"
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
      </div>
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
              <SplitButton
                primaryText="Allow"
                onPrimaryClick={() => {
                  handleToolCall()
                  setIsOpen(false)
                }}
                menuOptions={
                  isCodexTool
                    ? [
                        {
                          label: 'Allow for this chat',
                          onClick: () => {
                            handleToolCall()
                            handleAllowForConversation()
                            setIsOpen(false)
                          },
                        },
                      ]
                    : [
                        {
                          label: 'Always allow this tool',
                          onClick: () => {
                            handleToolCall()
                            handleAllowAutoExecution()
                            setIsOpen(false)
                          },
                        },
                        {
                          label: 'Allow for this chat',
                          onClick: () => {
                            handleToolCall()
                            handleAllowForConversation()
                            setIsOpen(false)
                          },
                        },
                      ]
                }
              />
              <button
                onClick={() => {
                  handleReject()
                  setIsOpen(false)
                }}
              >
                Reject
              </button>
            </div>
          )}
          {response.status === ToolCallResponseStatus.Running && (
            <div className="smtcmp-toolcall-footer-actions">
              <button onClick={handleAbort}>Abort</button>
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
  const { settings, setSettings } = useSettings()
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
    const server = settings.mcp.servers.find((s) => s.id === serverName)
    if (!server) {
      throw new Error(`Server ${serverName} not found`)
    }
    const toolOptions = { ...server.toolOptions }
    if (!toolOptions[toolName]) {
      // If the tool is not in the toolOptions, add it with default values
      toolOptions[toolName] = {
        allowAutoExecution: false,
        disabled: false,
      }
    }
    toolOptions[toolName] = {
      ...toolOptions[toolName],
      allowAutoExecution: true,
    }

    setSettings({
      ...settings,
      mcp: {
        ...settings.mcp,
        servers: settings.mcp.servers.map((s) =>
          s.id === server.id
            ? {
                ...s,
                toolOptions: toolOptions,
              }
            : s,
        ),
      },
    })
  }, [request, settings, setSettings])

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
