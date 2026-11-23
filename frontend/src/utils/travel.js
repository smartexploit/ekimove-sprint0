/** "Sat 13 Dec, 7:00 am", always in Nigerian time. */
export function travelTime(iso, withYear = false) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short',
    ...(withYear ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit',
  })
}
