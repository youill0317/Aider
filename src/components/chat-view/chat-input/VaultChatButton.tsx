import * as Tooltip from '@radix-ui/react-tooltip'
import { Platform } from 'obsidian'

export function VaultChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="smtcmp-chat-secondary-button"
            onClick={onClick}
          >
            Vault
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="smtcmp-tooltip-content" sideOffset={5}>
            Chat with your entire vault ·{' '}
            {Platform.isMacOS ? '⌘⇧↵' : 'Ctrl+Shift+↵'}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
