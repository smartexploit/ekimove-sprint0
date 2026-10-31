import { useState } from 'react'
import { Star } from 'lucide-react'
import { savePlace } from '../../services/promoService.js'

const SUGGESTED = ['Home', 'Work', 'School']

function usableSaved(saved, places) {
  return saved.filter((item) => item.available && places.some((place) => place.id === item.place_id))
}

/** Saved places that are in the current list, as one-tap chips. */
export function SavedChips({ saved, places, onPick, label }) {
  const usable = usableSaved(saved, places)
  if (usable.length === 0) return null
  return (
    <div className="saved-chips" role="group" aria-label={label}>
      <span className="saved-chips-label" aria-hidden="true">{label.replace('Saved places for ', '').replace(/^./, (c) => c.toUpperCase())}</span>
      {usable.map((item) => (
        <button key={item.id} type="button" className="chip chip-sm" onClick={() => onPick(String(item.place_id))}>
          <Star size={12} aria-hidden="true" /> {item.label}
        </button>
      ))}
    </div>
  )
}

/** "Save this place" for the chosen pickup or destination. */
export function SavePlaceButton({ placeId, saved, onSaved, what = 'this place' }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!placeId) return null
  const existing = saved.find((item) => String(item.place_id) === String(placeId))
  if (existing) return null
  if (!open) {
    return (
      <button type="button" className="link-button link-tap small" onClick={() => setOpen(true)}>
        Save {what}
      </button>
    )
  }

  async function save(name) {
    const clean = (name ?? label).trim()
    if (!clean) return
    setBusy(true)
    setError('')
    try {
      onSaved(await savePlace(clean, Number(placeId)))
      setOpen(false)
      setLabel('')
    } catch (err) {
      setError(err.message || 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  const free = SUGGESTED.filter((name) => !saved.some((item) => item.label === name))
  return (
    <div className="save-place">
      <span className="small" style={{ fontWeight: 700 }}>Save {what} as</span>
      <div className="chip-row">
        {free.map((name) => (
          <button key={name} type="button" className="chip chip-sm" disabled={busy} onClick={() => save(name)}>{name}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <input className="input input-sm" aria-label="Name for this place" maxLength={40} placeholder="Or type a name"
          value={label} onChange={(event) => setLabel(event.target.value)} />
        <button type="button" className="btn btn-sm" disabled={busy || !label.trim()} onClick={() => save()}>Save</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <span className="field-hint field-hint-error">{error}</span>}
    </div>
  )
}


/** Under the route: saved-place chips for pickup and destination, and
 * links to save the places chosen. Renders nothing when there's nothing to show. */
export function SavedPlacesBar({ saved, places, originId, destinationId, onPick, onSaved }) {
  const hasChips = usableSaved(saved, places).length > 0
  const canSave = (id) => id && !saved.some((item) => String(item.place_id) === String(id))
  if (!hasChips && !canSave(originId) && !canSave(destinationId)) return null
  return (
    <div className="saved-bar">
      <SavedChips saved={saved} places={places} label="Saved places for pickup" onPick={(id) => onPick('origin_place_id', id)} />
      <SavedChips saved={saved} places={places} label="Saved places for destination"
        onPick={(id) => onPick('destination_place_id', id)} />
      <div className="saved-bar-actions">
        <SavePlaceButton placeId={originId} saved={saved} onSaved={onSaved} what="pickup" />
        <SavePlaceButton placeId={destinationId} saved={saved} onSaved={onSaved} what="destination" />
      </div>
    </div>
  )
}
