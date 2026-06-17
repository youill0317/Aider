import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronUp, Command, CornerDownLeftIcon } from 'lucide-react'
import { Platform } from 'obsidian'

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
              {Platform.isMacOS ? (
                <Command size={10} />
              ) : (
                <ChevronUp size={12} />
              )}
              <CornerDownLeftIcon size={12} />
            </div>
            <div>Agent</div>
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
