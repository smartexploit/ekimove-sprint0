/** Marker looks shared by the Google and Leaflet maps. */
export const ICON_CLASS = {
  driver: 'map-pin map-pin-driver',
  'driver-busy': 'map-pin map-pin-busy',
  'driver-offered': 'map-pin map-pin-offered',
  'driver-stale': 'map-pin map-pin-stale',
  pickup: 'map-pin map-pin-pickup',
  destination: 'map-pin map-pin-destination',
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export const ROUTE_COLOUR = '#0E4D3B'
