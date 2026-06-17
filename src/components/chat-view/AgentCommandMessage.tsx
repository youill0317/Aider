import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { memo, useState } from 'react'

import type { ChatAgentCommandMessage } from '../../types/chat'

import { ObsidianCodeBlock } from './ObsidianMarkdown'

const STATUS_LABELS: Record<ChatAgentCommandMessage['status'], string> = {
  error: 'Failed',
  running: 'Running',
  success: 'Completed',
}

const INPUT_LABELS: Record<ChatAgentCommandMessage['kind'], string> = {
  command: 'Command',
  'web-search': 'Search',
  'mcp-tool': 'Parameters',
}

const OUTPUT_LABELS: Record<ChatAgentCommandMessage['kind'], string> = {
  command: 'Output',
  'web-search': 'Query',
  'mcp-tool': 'Result',
}

const AgentCommandMessage = memo(function AgentCommandMessage({
  message,
}: {
  message: ChatAgentCommandMessage
}) {
  const [isOpen, setIsOpen] = useState(message.status !== 'success')

  return (
    <div className="smtcmp-toolcall-container">
      <div className="smtcmp-toolcall">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="smtcmp-toolcall-header"
        >
          <div className="smtcmp-toolcall-header-icon">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          <div className="smtcmp-toolcall-header-content">
            <span>{STATUS_LABELS[message.status]}</span>
            <span>&nbsp;&nbsp;</span>
            <span className="smtcmp-toolcall-header-tool-name">
              {message.title}
            </span>
          </div>
          <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
            <StatusIcon status={message.status} />
          </div>
        </div>
        {isOpen && (
          <div className="smtcmp-toolcall-content">
            {message.detail.length > 0 && (
              <div className="smtcmp-toolcall-content-section">
                <div>{message.detail}</div>
              </div>
            )}
            {message.input.length > 0 && (
              <div className="smtcmp-toolcall-content-section">
                <div>{INPUT_LABELS[message.kind]}:</div>
                <ObsidianCodeBlock
                  language={message.kind === 'command' ? 'bash' : undefined}
                  content={message.input}
                />
              </div>
            )}
            {message.output.length > 0 && (
              <div className="smtcmp-toolcall-content-section">
                <div>{OUTPUT_LABELS[message.kind]}:</div>
                <ObsidianCodeBlock content={message.output} />
              </div>
            )}
            {message.exitCode !== undefined && message.exitCode !== null && (
              <div className="smtcmp-toolcall-content-section">
                <div>Exit code: {message.exitCode}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

function StatusIcon({ status }: { status: ChatAgentCommandMessage['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={16} className="smtcmp-spin" />
    case 'success':
      return <Check size={16} />
    case 'error':
      return <X size={16} />
  }
}

export default AgentCommandMessage
