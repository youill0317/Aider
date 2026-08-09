import { CircleStop, CornerDownLeft } from 'lucide-react'

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
        <CircleStop size={12} />
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
      <CornerDownLeft size={12} />
      Chat
    </button>
  )
}
