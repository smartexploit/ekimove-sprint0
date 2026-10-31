export function formatNaira(amount, { decimals = 2 } = {}) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '₦—'

  return `₦${value.toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function formatDateTime(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  return date.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function titleCase(value) {
  if (!value) return ''
  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function initials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return `${first}${last}`.toUpperCase() || '?'
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

export const MOTORCYCLE_TYPES = ['motorcycle', 'motorbike']

export function isMotorcycle(vehicleType) {
  return MOTORCYCLE_TYPES.includes(String(vehicleType || '').toLowerCase())
}
