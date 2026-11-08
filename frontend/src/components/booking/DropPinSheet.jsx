import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, MapPin, X } from 'lucide-react'
import LazyMap from '../map/LazyMap.jsx'
import { apiRequest } from '../../services/authService.js'

/**
 * Full-screen map for a spot that isn't on the list: tap the map (or use
 * your location), then say how the driver will recognise it.
 */
export default function DropPinSheet({ title, initial, allowHere = false, onCancel, onDone }) {
  const [pin, setPin] = useState(initial ? { latitude: initial.latitude, longitude: initial.longitude } : null)
  const [label, setLabel] = useState(initial?.label || '')
  const [typed, setTyped] = useState(Boolean(initial?.label))
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const lookup = useRef(0)
  const inputRef = useRef(null)

  const markers = useMemo(() => (pin
    ? [{ id: 'pin', latitude: pin.latitude, longitude: pin.longitude, kind: 'pickup', title: label || 'Your spot' }]
    : []), [pin, label])

  // Suggest a street or landmark name for the spot, unless the rider typed one.
  useEffect(() => {
    if (!pin || typed) return undefined
    const id = ++lookup.current
    const timer = window.setTimeout(() => {
      apiRequest(`/api/v1/points/describe?latitude=${pin.latitude}&longitude=${pin.longitude}`)
        .then((data) => {
          if (id === lookup.current && data?.label) setLabel(data.label)
        })
        .catch(() => {})
    }, 500)
    return () => window.clearTimeout(timer)
  }, [pin, typed])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  function here() {
    if (!navigator.geolocation) {
      setError('This phone can’t share its location. Tap the map instead.')
      return
    }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setError('Couldn’t get your location. Allow location access, or tap the map.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const ready = pin && label.trim().length >= 3
  return (
    <div className="pin-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header className="pin-sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}><X size={20} /></button>
      </header>
      <p className="pin-sheet-tip">
        <MapPin size={16} aria-hidden="true" /> Tap the exact spot on the map. Zoom in to be accurate.
      </p>
      <div className="pin-sheet-map">
        <LazyMap markers={markers} height={Math.max(300, Math.min(480, Math.round(window.innerHeight * 0.5)))} follow label="Tap to drop your pin"
          onPick={(point) => {
            setPin({ latitude: point.lat, longitude: point.lng })
            setError('')
          }} />
      </div>
      <div className="pin-sheet-form">
        {allowHere && (
          <button type="button" className="btn btn-sm" onClick={here} disabled={locating}>
            <Crosshair size={16} aria-hidden="true" /> {locating ? 'Finding you…' : 'Use where I am now'}
          </button>
        )}
        <label className="field">
          <span className="field-label">How will the driver find you?</span>
          <input ref={inputRef} className="input" value={label} maxLength={120}
            placeholder="e.g. Blue gate opposite Mercy Pharmacy"
            onChange={(event) => {
              setLabel(event.target.value)
              setTyped(true)
            }} />
          <span className="field-hint">A landmark, gate colour or shop name helps the driver.</span>
        </label>
        {error && <p className="field-hint field-hint-error" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={!ready}
          onClick={() => onDone({ ...pin, label: label.trim() })}>
          {pin ? 'Use this spot' : 'Tap the map first'}
        </button>
      </div>
    </div>
  )
}
