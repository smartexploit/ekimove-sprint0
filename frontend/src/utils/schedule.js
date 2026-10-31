// Booking for later. EkiMove works in Lagos time (UTC+1, no daylight saving).
const LAGOS_OFFSET = '+01:00'
const MINUTE = 60 * 1000

/** "2026-11-01T07:30" in Lagos time, for <input type="datetime-local">. */
export function lagosInputValue(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function pickupLimits(now = Date.now()) {
  return {
    min: lagosInputValue(new Date(now + 30 * MINUTE)),
    max: lagosInputValue(new Date(now + 7 * 24 * 60 * MINUTE)),
    suggested: lagosInputValue(new Date(Math.ceil((now + 60 * MINUTE) / (15 * MINUTE)) * 15 * MINUTE)),
  }
}

/** Input value → ISO time with the Lagos offset, for the API. */
export function toApiTime(value) {
  return value ? `${value}:00${LAGOS_OFFSET}` : null
}

/** "Sat 1 Nov, 7:30 am" in Lagos time. */
export function formatPickupTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}
