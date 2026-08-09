import type React from 'react'

export type StatusBadgeTone =
  | 'connected'
  | 'connecting'
  | 'error'
  | 'disconnected'

export function StatusBadge({
  tone,
  icon,
  label,
}: {
  tone: StatusBadgeTone
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className={`smtcmp-status-badge smtcmp-status-badge--${tone}`}>
      {icon}
      <div className="smtcmp-status-badge-label">{label}</div>
    </div>
  )
}
