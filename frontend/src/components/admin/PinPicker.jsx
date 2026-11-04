import { useMemo, useState } from 'react'
import { Crosshair } from 'lucide-react'
import LazyMap from '../map/LazyMap.jsx'

/** Tap the map (or use this phone's location) to set a place's pin. */
export default function PinPicker({ latitude, longitude, onChange, name }) {
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const lat = latitude === '' || latitude == null ? null : Number(latitude)
  const lng = longitude === '' || longitude == null ? null : Number(longitude)
  const markers = useMemo(() => (Number.isFinite(lat) && Number.isFinite(lng)
    ? [{ id: 'pin', latitude: lat, longitude: lng, kind: 'pickup', title: name || 'Place' }] : []), [lat, lng, name])

  const set = (a, b) => onChange(Number(a).toFixed(6), Number(b).toFixed(6))

  function here() {
    if (!navigator.geolocation) {
      setError('This device can’t share its location.')
      return
    }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set(pos.coords.latitude, pos.coords.longitude)
        setLocating(false)
      },
      () => {
        setError('Couldn’t get your location. Allow location access, or tap the map instead.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  return (
    <div className="field pin-picker">
      <span className="field-label">Map pin</span>
      <span className="field-hint">Tap the exact spot on the map. Fares are worked out from the road distance between pins.</span>
      <LazyMap markers={markers} height={240} follow label="Tap to place the pin" onPick={(p) => set(p.lat, p.lng)} />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={here} disabled={locating}>
          <Crosshair size={16} aria-hidden="true" /> {locating ? 'Finding you…' : 'Use where I am now'}
        </button>
        {markers.length > 0 && <span className="muted small">{lat.toFixed(5)}, {lng.toFixed(5)}</span>}
      </div>
      {error && <span className="field-hint field-hint-error">{error}</span>}
    </div>
  )
}
