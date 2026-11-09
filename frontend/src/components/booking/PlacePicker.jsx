import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { indexPlaces, searchPlaces } from '../../utils/placeSearch.js'
import { pinOf } from '../../utils/stops.js'
import { apiRequest } from '../../services/authService.js'

let googleSetting = null
function googleSearchOn() {
  if (!googleSetting) {
    googleSetting = apiRequest('/api/v1/places/settings').then((d) => Boolean(d?.enabled)).catch(() => false)
  }
  return googleSetting
}

function newSession() {
  try {
    return crypto.randomUUID().replaceAll('-', '')
  } catch {
    return `${Date.now()}${Math.random().toString(36).slice(2)}`.slice(0, 40)
  }
}

/**
 * Pickup / destination picker with search: type a place, street, junction
 * or landmark and pick from the matching places EkiMove serves. When pins
 * are allowed and Google search is set up, addresses from Google show
 * under the list; choosing one opens the map there to confirm the spot.
 */
export default function PlacePicker({
  label, value, onChange, places, disabled = false, loading = false, placeholder = 'Search a place, street or junction',
  name, required = false, hint, onDropPin = null,
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [googleOn, setGoogleOn] = useState(false)
  const [found, setFound] = useState({ q: '', items: [] })
  const [resolving, setResolving] = useState('')
  const [googleError, setGoogleError] = useState('')
  const session = useRef(null)

  const index = useMemo(() => indexPlaces(places || []), [places])
  const results = useMemo(() => searchPlaces(index, query), [index, query])
  const term = query.trim()
  const google = useMemo(() => (onDropPin && googleOn && found.q === term ? found.items : []),
    [onDropPin, googleOn, found, term])
  const options = useMemo(() => [
    ...results.map((r) => ({ type: 'place', ...r })),
    ...google.map((g) => ({ type: 'google', g })),
    ...(onDropPin ? [{ type: 'drop' }] : []),
  ], [results, google, onDropPin])

  useEffect(() => {
    let active = true
    if (onDropPin) googleSearchOn().then((on) => active && setGoogleOn(on))
    return () => {
      active = false
    }
  }, [onDropPin])

  // Ask Google once typing pauses (each keystroke would cost money).
  useEffect(() => {
    if (!open || !googleOn || !onDropPin || term.length < 3) return undefined
    const timer = window.setTimeout(() => {
      if (!session.current) session.current = newSession()
      apiRequest(`/api/v1/places/search?q=${encodeURIComponent(term)}&session=${session.current}`)
        .then((data) => setFound({ q: term, items: data?.suggestions || [] }))
        .catch(() => setFound({ q: term, items: [] }))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [term, open, googleOn, onDropPin])
  const pin = pinOf(value)
  const selected = pin ? { id: value, name: `📍 ${pin.label}` }
    : (places || []).find((place) => String(place.id) === String(value))

  useEffect(() => {
    const option = listRef.current?.querySelector(`[data-index="${active}"]`)
    option?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function openList() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    setActive(0)
    // Keep the list visible above the phone keyboard.
    window.setTimeout(() => inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250)
  }

  function choose(place) {
    onChange(String(place.id))
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function dropPin() {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    onDropPin(pin)
  }

  async function chooseGoogle(g) {
    setResolving(g.place_id)
    setGoogleError('')
    try {
      const spot = await apiRequest('/api/v1/places/resolve', {
        method: 'POST', body: JSON.stringify({ place_id: g.place_id, session: session.current }),
      })
      session.current = null // a search session ends with the lookup
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
      onDropPin({ latitude: spot.latitude, longitude: spot.longitude, label: g.name })
    } catch (err) {
      setGoogleError(err.message || 'Couldn’t find that address. Try dropping a pin instead.')
    } finally {
      setResolving('')
    }
  }

  function pick(option) {
    if (!option) return
    if (option.type === 'place') choose(option.place)
    else if (option.type === 'google') chooseGoogle(option.g)
    else dropPin()
  }

  function onKeyDown(event) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      event.preventDefault()
      openList()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(options[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const shown = open ? query : (selected?.name || '')
  const emptyText = loading ? 'Loading places…' : disabled ? 'Choose a service area first' : placeholder

  return (
    <div className="field place-picker">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className={`place-input ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}>
        <Search size={18} aria-hidden="true" className="place-input-icon" />
        <input
          ref={inputRef}
          id={id}
          name={name}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={60}
          disabled={disabled}
          placeholder={emptyText}
          value={shown}
          onFocus={openList}
          onClick={() => !open && openList()}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            if (!open) setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        {/* Keeps native "required" validation working for the form. */}
        {required && (
          <input className="sr-only" tabIndex={-1} aria-hidden="true" required value={value || ''}
            onChange={() => {}} onFocus={() => inputRef.current?.focus()} />
        )}
        {selected && !open && !disabled && (
          <button type="button" className="place-clear" aria-label={`Clear ${label.toLowerCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <ul ref={listRef} id={listId} className="place-list" role="listbox" aria-label={`${label} places`}
          onMouseDown={(event) => event.preventDefault()}>
          {results.length === 0 && google.length === 0 && (
            <li className="place-empty" role="presentation">
              No place matches “{query}”.{' '}
              {onDropPin ? 'Try a nearby landmark, or drop a pin on the map below.' : 'Try a nearby landmark, junction or the area’s name.'}
            </li>
          )}
          {options.map((option, i) => {
            const common = {
              id: `${id}-opt-${i}`, 'data-index': i, role: 'option', onMouseEnter: () => setActive(i),
              onClick: () => pick(option),
            }
            if (option.type === 'place') {
              const { place, via } = option
              return (
                <li key={place.id} {...common} aria-selected={String(place.id) === String(value)}
                  className={`place-option ${i === active ? 'is-active' : ''}`}>
                  <MapPin size={16} aria-hidden="true" />
                  <span>
                    <span className="place-name">{place.name}</span>
                    <span className="place-meta">
                      {[via ? `Also called ${via}` : null, place.address_text, place.zone].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              )
            }
            if (option.type === 'google') {
              const { g } = option
              return (
                <li key={`g-${g.place_id}`} {...common} aria-selected={false}
                  className={`place-option place-google ${i === active ? 'is-active' : ''}`}>
                  <MapPin size={16} aria-hidden="true" />
                  <span>
                    <span className="place-name">{g.name}</span>
                    <span className="place-meta">
                      {resolving === g.place_id ? 'Finding it on the map…' : [g.detail, 'Priced by distance'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </li>
              )
            }
            return (
              <li key="drop" {...common} aria-selected={false}
                className={`place-option place-drop ${i === active ? 'is-active' : ''}`}>
                <MapPin size={16} aria-hidden="true" />
                <span>
                  <span className="place-name">Not on the list? Drop a pin on the map</span>
                  <span className="place-meta">Priced by distance</span>
                </span>
              </li>
            )
          })}
          {googleError && <li className="place-empty place-error" role="alert">{googleError}</li>}
          {google.length > 0 && <li className="place-attribution" role="presentation">Address results: Google Maps</li>}
        </ul>
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
