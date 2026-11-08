/**
 * A pickup or destination is either a listed place (its id, e.g. "12") or a
 * pin the rider dropped on the map, stored in the same form field as
 * "pin:" + JSON { latitude, longitude, label }.
 */
const PREFIX = 'pin:'

export const isPin = (value) => typeof value === 'string' && value.startsWith(PREFIX)

export function pinOf(value) {
  if (!isPin(value)) return null
  try {
    const pin = JSON.parse(value.slice(PREFIX.length))
    return Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude) ? pin : null
  } catch {
    return null
  }
}

export const pinValue = (pin) => PREFIX + JSON.stringify({
  latitude: Number(Number(pin.latitude).toFixed(6)),
  longitude: Number(Number(pin.longitude).toFixed(6)),
  label: String(pin.label || '').trim().slice(0, 120),
})

/** The API shape of a stop: { place_id } or { point }. */
export function stopOf(value) {
  const pin = pinOf(value)
  return pin ? { point: pin } : { place_id: Number(value) }
}

/** Fields for POST /ride-requests. */
export function bookingStops(origin, destination) {
  const out = {}
  const a = pinOf(origin)
  const b = pinOf(destination)
  if (a) out.origin_point = a
  else out.origin_place_id = Number(origin)
  if (b) out.destination_point = b
  else out.destination_place_id = Number(destination)
  return out
}
