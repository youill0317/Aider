import { ArrowUp, CircleStop } from 'lucide-react'

export function SubmitButton({
  onClick,
  isWorking = false,
  onStop,
}: {
  onClick: () => void
  isWorking?: boolean
  onStop?: () => void
}) {
  if (isWorking) {
    return (
      <button
        type="button"
        className="smtcmp-chat-stop-button"
        onClick={onStop}
      >
        <CircleStop size={14} />
        Stop
      </button>
    )
  }

  return (
    <button
      type="button"
      className="smtcmp-chat-primary-button"
      onClick={onClick}
    >
      <ArrowUp size={14} />
      Chat
    </button>
  )
}
