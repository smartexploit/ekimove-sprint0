import { useEffect, useRef, useState } from 'react'
import { ICON_CLASS, ROUTE_COLOUR } from './mapPins.js'

let loading = null
let authFailed = false
const failureListeners = new Set()

/** Loads Google's Maps JavaScript API once for the whole app. */
function loadGoogleMaps(key) {
  if (authFailed) return Promise.reject(new Error('Google Maps key refused'))
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      // Google calls this when the key is wrong or not allowed on this site.
      window.gm_authFailure = () => {
        authFailed = true
        failureListeners.forEach((fn) => fn())
      }
      window.__ekimoveMapsReady = () => {
        Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('marker')])
          .then(() => resolve(window.google.maps))
          .catch(reject)
      }
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
        + '&v=weekly&loading=async&libraries=maps,marker&callback=__ekimoveMapsReady'
      script.async = true
      script.onerror = () => {
        loading = null
        reject(new Error('Google Maps did not load'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

function pinElement(kind, text) {
  const wrap = document.createElement('div')
  wrap.style.transform = 'translateY(50%)' // centre the pin on its spot, like the Leaflet map
  const pin = document.createElement('span')
  pin.className = ICON_CLASS[kind] || 'map-pin'
  if (text) {
    const inner = document.createElement('span')
    inner.textContent = text
    pin.appendChild(inner)
  }
  wrap.appendChild(pin)
  return wrap
}

function popupElement(text) {
  const box = document.createElement('div')
  box.className = 'gmap-popup'
  box.textContent = text
  return box
}

/**
 * The same map as LeafletMap (markers, trail, tap to pick, fit on first
 * load), drawn with Google Maps. Calls onFail if Google can't be used, so
 * the app can fall back to the plain map.
 */
export default function GoogleMap({ config, markers = [], trail = [], height = 280, follow = false, label = 'Map',
  onPick = null, onFail }) {
  const box = useRef(null)
  const map = useRef(null)
  const drawn = useRef([])
  const popup = useRef(null)
  const fitted = useRef(false)
  const pickRef = useRef(onPick)
  const failRef = useRef(onFail)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    pickRef.current = onPick
    failRef.current = onFail
  }, [onPick, onFail])

  useEffect(() => {
    let active = true
    const fail = () => active && failRef.current?.()
    failureListeners.add(fail)
    loadGoogleMaps(config.google_key).then((maps) => {
      if (!active || !box.current || map.current) return
      map.current = new maps.Map(box.current, {
        center: { lat: config.center.latitude, lng: config.center.longitude },
        zoom: 13,
        mapId: config.google_map_id || undefined,
        gestureHandling: 'cooperative',
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })
      popup.current = new maps.InfoWindow()
      // Tap the map to choose a point (drop a pin, set a place's pin).
      map.current.addListener('click', (event) => {
        if (event.latLng) pickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() })
      })
      setReady(true)
    }).catch(fail)
    return () => {
      active = false
      failureListeners.delete(fail)
      drawn.current.forEach((item) => (item.setMap ? item.setMap(null) : (item.map = null)))
      drawn.current = []
      map.current = null
    }
  }, [config])

  useEffect(() => {
    const maps = window.google?.maps
    if (!ready || !map.current || !maps) return
    drawn.current.forEach((item) => (item.setMap ? item.setMap(null) : (item.map = null)))
    drawn.current = []
    const bounds = new maps.LatLngBounds()
    let count = 0
    if (trail.length > 1) {
      const path = trail.map(([lat, lng]) => ({ lat, lng }))
      drawn.current.push(new maps.Polyline({ map: map.current, path, strokeColor: ROUTE_COLOUR, strokeWeight: 4,
        strokeOpacity: 0.8 }))
      path.forEach((p) => bounds.extend(p))
      count += path.length
    }
    const useAdvanced = Boolean(config.google_map_id && maps.marker?.AdvancedMarkerElement)
    markers
      .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
      .forEach((m) => {
        const position = { lat: m.latitude, lng: m.longitude }
        const marker = useAdvanced
          ? new maps.marker.AdvancedMarkerElement({ map: map.current, position, title: m.title || '',
            content: pinElement(m.kind, m.label) })
          : new maps.Marker({ map: map.current, position, title: m.title || '', label: m.label || undefined })
        if (m.popup) {
          const open = () => {
            popup.current.setContent(popupElement(m.popup))
            popup.current.open({ map: map.current, anchor: marker })
          }
          if (useAdvanced) marker.addEventListener('gmp-click', open)
          else marker.addListener('click', open)
        }
        drawn.current.push(marker)
        bounds.extend(position)
        count += 1
      })
    if (count && (follow || !fitted.current)) {
      if (count === 1) {
        map.current.setCenter(bounds.getCenter())
        map.current.setZoom(15)
      } else {
        map.current.fitBounds(bounds, 36)
        maps.event.addListenerOnce(map.current, 'idle', () => {
          if (map.current && map.current.getZoom() > 16) map.current.setZoom(16)
        })
      }
      fitted.current = true
    }
  }, [ready, markers, trail, follow, config])

  return <div ref={box} className="live-map" style={{ height }} role="img" aria-label={label} />
}
