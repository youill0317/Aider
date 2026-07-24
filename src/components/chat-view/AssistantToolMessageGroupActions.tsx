import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, CopyIcon } from 'lucide-react'
import { Notice } from 'obsidian'
import { useMemo, useState } from 'react'

import { AssistantToolMessageGroup } from '../../types/chat'

import { summarizeAssistantResponses } from './assistant-response-summary'
import LLMResponseInfoPopover from './LLMResponseInfoPopover'
import { getToolMessageContent } from './ToolMessage'

function CopyButton({ messages }: { messages: AssistantToolMessageGroup }) {
  const [copied, setCopied] = useState(false)

  const content = useMemo(() => {
    return messages
      .map((message) => {
        switch (message.role) {
          case 'assistant':
            return message.content === '' ? null : message.content
          case 'tool':
            return getToolMessageContent(message)
          case 'agent-command':
            return [
              [message.title, message.detail].filter(Boolean).join(' '),
              `Status: ${message.status}`,
              ...(message.exitCode !== undefined
                ? [`Exit code: ${message.exitCode ?? 'running'}`]
                : []),
              message.input,
              message.output,
            ]
              .filter((line) => line.length > 0)
              .join('\n')
        }
      })
      .filter(Boolean)
      .join('\n\n')
  }, [messages])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch (error) {
      new Notice('Failed to copy the message to the clipboard')
      console.error('Failed to copy message', error)
    }
  }

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            onClick={copied ? undefined : handleCopy}
            className="clickable-icon"
            aria-label={copied ? 'Message copied' : 'Copy message'}
          >
            {copied ? <Check size={12} /> : <CopyIcon size={12} />}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content">
            Copy message
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

function LLMResponseInfoButton({
  messages,
}: {
  messages: AssistantToolMessageGroup
}) {
  const summary = useMemo(
    () => summarizeAssistantResponses(messages),
    [messages],
  )

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div>
            <LLMResponseInfoPopover
              usage={summary.usage}
              estimatedPrice={summary.estimatedPrice}
              model={summary.model}
            />
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content">
            View details
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export default function AssistantToolMessageGroupActions({
  messages,
}: {
  messages: AssistantToolMessageGroup
}) {
  return (
    <div className="smtcmp-assistant-message-actions">
      <LLMResponseInfoButton messages={messages} />
      <CopyButton messages={messages} />
    </div>
  )
}
