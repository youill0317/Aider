import * as Tooltip from '@radix-ui/react-tooltip'

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
            aria-disabled={disabled}
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
              : 'Run Codex with your Agent settings'}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
