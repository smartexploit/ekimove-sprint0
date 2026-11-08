import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { indexPlaces, searchPlaces } from '../../utils/placeSearch.js'
import { pinOf } from '../../utils/stops.js'

/**
 * Pickup / destination picker with search: type a place, street, junction
 * or landmark and pick from the matching places EkiMove serves.
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

  const index = useMemo(() => indexPlaces(places || []), [places])
  const results = useMemo(() => searchPlaces(index, query), [index, query])
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

  function onKeyDown(event) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      event.preventDefault()
      openList()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - (onDropPin ? 0 : 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (results[active]) choose(results[active].place)
      else if (onDropPin && active === results.length) dropPin()
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
          aria-activedescendant={open && (results[active] || (onDropPin && active === results.length)) ? `${id}-opt-${active}` : undefined}
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
          {results.length === 0 ? (
            <li className="place-empty" role="presentation">
              No place matches “{query}”.{' '}
              {onDropPin ? 'Try a nearby landmark, or drop a pin on the map below.' : 'Try a nearby landmark, junction or the area’s name.'}
            </li>
          ) : results.map(({ place, via }, i) => (
            <li
              key={place.id}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={String(place.id) === String(value)}
              className={`place-option ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(place)}
            >
              <MapPin size={16} aria-hidden="true" />
              <span>
                <span className="place-name">{place.name}</span>
                <span className="place-meta">
                  {[via ? `Also called ${via}` : null, place.address_text, place.zone].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
          {onDropPin && (
            <li id={`${id}-opt-${results.length}`} data-index={results.length} role="option" aria-selected={false}
              className={`place-option place-drop ${active === results.length ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(results.length)} onClick={dropPin}>
              <MapPin size={16} aria-hidden="true" />
              <span>
                <span className="place-name">Not on the list? Drop a pin on the map</span>
                <span className="place-meta">Priced by distance</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
