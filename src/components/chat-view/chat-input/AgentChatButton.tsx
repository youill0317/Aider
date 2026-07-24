import * as Tooltip from '@radix-ui/react-tooltip'
import { Platform } from 'obsidian'

export function AgentChatButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="smtcmp-chat-secondary-button"
            onClick={onClick}
            disabled={disabled}
            aria-label={
              disabled
                ? 'Agent unavailable. Enable Codex in settings on desktop.'
                : 'Run Agent'
            }
          >
            Agent
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content" sideOffset={5}>
            {disabled
              ? 'Enable Codex in Agent settings on desktop'
              : `Run Codex with your Agent settings · ${
                  Platform.isMacOS ? '⌘↵' : 'Ctrl+↵'
                }`}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
