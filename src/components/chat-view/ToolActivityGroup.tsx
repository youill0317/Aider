import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { ChatAgentCommandMessage } from '../../types/chat'
import type { ToolCallResponse } from '../../types/tool-call.types'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import AgentCommandMessage from './AgentCommandMessage'
import { ObsidianCodeBlock } from './ObsidianMarkdown'
import {
  type ToolActivityMessage,
  type ToolActivityStep,
  formatToolArguments,
  getFirstSelectedStepId,
  getToolActivityHeader,
  getToolActivitySteps,
  shouldOpenActivityTimeline,
  shouldUseActivityTimeline,
} from './tool-activity'
import ToolMessage from './ToolMessage'
import type {
  AbortApprovedToolCall,
  ExecuteApprovedToolCall,
  ToolCallResponseUpdater,
} from './ToolMessage'

export default function ToolActivityGroup({
  messages,
  conversationId,
  executeToolCall,
  abortToolCall,
  onToolCallResponseUpdate,
}: {
  messages: readonly ToolActivityMessage[]
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  onToolCallResponseUpdate: ToolCallResponseUpdater
}) {
  const steps = useMemo(() => getToolActivitySteps(messages), [messages])

  if (!shouldUseActivityTimeline(steps)) {
    return (
      <ToolActivityMessageList
        messages={messages}
        conversationId={conversationId}
        executeToolCall={executeToolCall}
        abortToolCall={abortToolCall}
        onToolCallResponseUpdate={onToolCallResponseUpdate}
      />
    )
  }

  return <CompletedToolActivityTimeline steps={steps} />
}

function ToolActivityMessageList({
  messages,
  conversationId,
  executeToolCall,
  abortToolCall,
  onToolCallResponseUpdate,
}: {
  messages: readonly ToolActivityMessage[]
  conversationId: string
  executeToolCall: ExecuteApprovedToolCall
  abortToolCall: AbortApprovedToolCall
  onToolCallResponseUpdate: ToolCallResponseUpdater
}) {
  return (
    <>
      {messages.map((message) =>
        message.role === 'tool' ? (
          <div key={message.id}>
            <ToolMessage
              message={message}
              conversationId={conversationId}
              executeToolCall={executeToolCall}
              abortToolCall={abortToolCall}
              onToolCallResponseUpdate={onToolCallResponseUpdate}
            />
          </div>
        ) : (
          <div key={message.id}>
            <AgentCommandMessage message={message} />
          </div>
        ),
      )}
    </>
  )
}

function CompletedToolActivityTimeline({
  steps,
}: {
  steps: readonly ToolActivityStep[]
}) {
  const shouldOpen = shouldOpenActivityTimeline(steps)
  const firstSelectedStepId = getFirstSelectedStepId(steps)
  const [isOpen, setIsOpen] = useState(shouldOpen)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    firstSelectedStepId,
  )

  useEffect(() => {
    if (shouldOpen) {
      setIsOpen(true)
      setSelectedStepId(firstSelectedStepId)
    }
  }, [firstSelectedStepId, shouldOpen])

  const selectedStep =
    steps.find((step) => step.id === selectedStepId) ?? steps[0] ?? null

  return (
    <div className="smtcmp-toolcall-container smtcmp-tool-activity">
      <div className="smtcmp-toolcall">
        <button
          type="button"
          className="smtcmp-toolcall-header smtcmp-tool-activity-summary"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((currentIsOpen) => !currentIsOpen)}
        >
          <div className="smtcmp-toolcall-header-icon">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          <div className="smtcmp-toolcall-header-content smtcmp-tool-activity-summary-text">
            {getToolActivityHeader(steps)}
          </div>
          <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
            <GroupStatusIcon steps={steps} />
          </div>
        </button>
        {isOpen && (
          <>
            <div className="smtcmp-tool-activity-timeline">
              {steps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={
                    step.id === selectedStep?.id
                      ? 'smtcmp-tool-activity-step smtcmp-tool-activity-step--selected'
                      : 'smtcmp-tool-activity-step'
                  }
                  aria-pressed={step.id === selectedStep?.id}
                  onClick={() => setSelectedStepId(step.id)}
                >
                  <span className="smtcmp-tool-activity-step-status">
                    <StepStatusIcon step={step} />
                  </span>
                  <span className="smtcmp-tool-activity-step-title">
                    {step.title}
                  </span>
                  {step.summary && (
                    <span className="smtcmp-tool-activity-step-summary">
                      {step.summary}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {selectedStep && <ToolActivityStepDetail step={selectedStep} />}
          </>
        )}
      </div>
    </div>
  )
}

function GroupStatusIcon({ steps }: { steps: readonly ToolActivityStep[] }) {
  if (steps.some((step) => step.isActive)) {
    return <Loader2 size={16} className="smtcmp-spin" />
  }

  if (steps.some((step) => !step.isSuccessful)) {
    return <X size={16} />
  }

  return <Check size={16} />
}

function StepStatusIcon({ step }: { step: ToolActivityStep }) {
  if (step.isActive) {
    return <Loader2 size={14} className="smtcmp-spin" />
  }

  if (step.isSuccessful) {
    return <Check size={14} />
  }

  return <X size={14} />
}

function ToolActivityStepDetail({ step }: { step: ToolActivityStep }) {
  if (step.kind === 'agent-command') {
    return <AgentCommandStepDetail message={step.message} />
  }

  return (
    <div className="smtcmp-toolcall-content smtcmp-tool-activity-detail">
      <div className="smtcmp-toolcall-content-section">
        <div>Parameters:</div>
        <ObsidianCodeBlock
          language="json"
          content={formatToolArguments(step.request.arguments)}
        />
      </div>
      <ToolResponseDetail response={step.response} />
    </div>
  )
}

function ToolResponseDetail({ response }: { response: ToolCallResponse }) {
  switch (response.status) {
    case ToolCallResponseStatus.Success:
      return (
        <div className="smtcmp-toolcall-content-section">
          <div>Result:</div>
          <ObsidianCodeBlock content={response.data.text} />
        </div>
      )
    case ToolCallResponseStatus.Error:
      return (
        <div className="smtcmp-toolcall-content-section">
          <div>Error:</div>
          <ObsidianCodeBlock content={response.error} />
        </div>
      )
    case ToolCallResponseStatus.PendingApproval:
      return (
        <div className="smtcmp-toolcall-content-section">Pending approval</div>
      )
    case ToolCallResponseStatus.Running:
      return <div className="smtcmp-toolcall-content-section">Running</div>
    case ToolCallResponseStatus.Rejected:
      return <div className="smtcmp-toolcall-content-section">Rejected</div>
    case ToolCallResponseStatus.Aborted:
      return <div className="smtcmp-toolcall-content-section">Aborted</div>
  }
}

const AGENT_INPUT_LABELS: Record<ChatAgentCommandMessage['kind'], string> = {
  command: 'Command',
  'web-search': 'Search',
  'mcp-tool': 'Parameters',
}

const AGENT_OUTPUT_LABELS: Record<ChatAgentCommandMessage['kind'], string> = {
  command: 'Output',
  'web-search': 'Query',
  'mcp-tool': 'Result',
}

function AgentCommandStepDetail({
  message,
}: {
  message: ChatAgentCommandMessage
}) {
  return (
    <div className="smtcmp-toolcall-content smtcmp-tool-activity-detail">
      {message.detail.length > 0 && (
        <div className="smtcmp-toolcall-content-section">
          <div>{message.detail}</div>
        </div>
      )}
      {message.input.length > 0 && (
        <div className="smtcmp-toolcall-content-section">
          <div>{AGENT_INPUT_LABELS[message.kind]}:</div>
          <ObsidianCodeBlock
            language={message.kind === 'command' ? 'bash' : undefined}
            content={message.input}
          />
        </div>
      )}
      {message.output.length > 0 && (
        <div className="smtcmp-toolcall-content-section">
          <div>{AGENT_OUTPUT_LABELS[message.kind]}:</div>
          <ObsidianCodeBlock content={message.output} />
        </div>
      )}
      {message.exitCode !== undefined && message.exitCode !== null && (
        <div className="smtcmp-toolcall-content-section">
          <div>Exit code: {message.exitCode}</div>
        </div>
      )}
    </div>
  )
}
