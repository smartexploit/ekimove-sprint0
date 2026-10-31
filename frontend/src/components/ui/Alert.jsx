import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

const ICONS = {
  error: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

/**
 * Inline message. Errors are announced immediately (role="alert");
 * everything else politely (role="status").
 */
export default function Alert({ tone = 'info', children, className = '' }) {
  if (!children) return null
  const Icon = ICONS[tone] || Info

  return (
    <div
      className={`alert alert-${tone} ${className}`.trim()}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
