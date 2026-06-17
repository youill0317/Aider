import * as Tooltip from '@radix-ui/react-tooltip'
import { CornerDownLeftIcon } from 'lucide-react'

export function AgentChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className="smtcmp-chat-user-input-submit-button"
            onClick={onClick}
          >
            <div className="smtcmp-chat-user-input-submit-button-icons">
              <span className="smtcmp-agent-chat-button-symbol">{'>_'}</span>
              <CornerDownLeftIcon size={12} />
            </div>
            <div>{'>_ Agent'}</div>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content" sideOffset={5}>
            Run Codex with your Agent settings
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
