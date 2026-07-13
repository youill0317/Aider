import * as Tooltip from '@radix-ui/react-tooltip'
import { Platform } from 'obsidian'

export function AgentChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="smtcmp-chat-secondary-button"
            onClick={onClick}
          >
            Agent
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content" sideOffset={5}>
            Run Codex with your Agent settings ·{' '}
            {Platform.isMacOS ? '⌘↵' : 'Ctrl+↵'}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
