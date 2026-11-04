import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getMapConfig } from '../../services/tripService.js'

let configPromise = null
function loadConfig() {
  if (!configPromise) {
    configPromise = getMapConfig().catch(() => ({
      tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      center: { latitude: 7.6233, longitude: 5.2214 },
    }))
  }
  return configPromise
}

const ICON_CLASS = {
  driver: 'map-pin map-pin-driver',
  'driver-busy': 'map-pin map-pin-busy',
  'driver-offered': 'map-pin map-pin-offered',
  'driver-stale': 'map-pin map-pin-stale',
  pickup: 'map-pin map-pin-pickup',
  destination: 'map-pin map-pin-destination',
}

function icon(kind, label) {
  return L.divIcon({
    className: '',
    html: `<span class="${ICON_CLASS[kind] || 'map-pin'}">${label ? `<span>${label}</span>` : ''}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/**
 * A Leaflet map with markers ({ id, latitude, longitude, kind, label, popup })
 * and an optional trail (array of [lat, lng]). Fits everything in view the
 * first time, then keeps the view unless `follow` is set.
 */
export default function LiveMap({ markers = [], trail = [], height = 280, follow = false, label = 'Map', onPick = null }) {
  const box = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const fitted = useRef(false)
  const pickRef = useRef(onPick)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    pickRef.current = onPick
  }, [onPick])

  useEffect(() => {
    let active = true
    loadConfig().then((config) => {
      if (!active || !box.current || map.current) return
      map.current = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
        .setView([config.center.latitude, config.center.longitude], 13)
      L.tileLayer(config.tile_url, { attribution: config.attribution, maxZoom: 19 }).addTo(map.current)
      layer.current = L.layerGroup().addTo(map.current)
      // Tap the map to choose a point (used for place pins in the console).
      map.current.on('click', (event) => pickRef.current?.(event.latlng))
      setReady(true)
    })
    return () => {
      active = false
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready || !layer.current) return
    layer.current.clearLayers()
    const points = []
    if (trail.length > 1) {
      L.polyline(trail, { color: '#0E4D3B', weight: 4, opacity: 0.8 }).addTo(layer.current)
      points.push(...trail)
    }
    markers
      .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
      .forEach((m) => {
        const marker = L.marker([m.latitude, m.longitude], { icon: icon(m.kind, m.label), title: m.title || '' })
        if (m.popup) marker.bindPopup(escapeHtml(m.popup).replaceAll('\n', '<br>'))
        marker.addTo(layer.current)
        points.push([m.latitude, m.longitude])
      })
    if (points.length && (follow || !fitted.current)) {
      if (points.length === 1) map.current.setView(points[0], 15)
      else map.current.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 })
      fitted.current = true
    }
  }, [ready, markers, trail, follow])

  return <div ref={box} className="live-map" style={{ height }} role="img" aria-label={label} />
}
