import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Crosshair, MapPin, MapPinned, Navigation, Plus, Search, X } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import LazyMap from '../../components/map/LazyMap.jsx'
import { apiRequest } from '../../services/authService.js'
import useGpsReading from '../../hooks/useGpsReading.js'

const TYPES = {
  landmark: 'Landmark', junction: 'Junction', bus_stop: 'Bus stop', street: 'Street',
  neighbourhood: 'Neighbourhood', other: 'Other',
}
const SOURCE = {
  field: 'Set on site', trips: 'From real trips', rider: 'Suggested by riders', manual: 'Placed by staff',
  auto: 'Guessed from the name',
}
const TABS = [['attention', 'Needs attention'], ['all', 'All places'], ['checked', 'Checked'], ['suggestions', 'Rider suggestions']]

function GpsReadout({ gps, maxAccuracy }) {
  if (gps.status === 'idle') return null
  if (gps.status === 'error') return <Alert tone="error">{gps.error}</Alert>
  const r = gps.reading
  const ok = r && r.accuracy_m <= maxAccuracy
  return (
    <p className={`gps-readout ${ok ? 'is-ok' : ''}`} role="status">
      <Crosshair size={16} aria-hidden="true" />
      {!r ? 'Finding your location…'
        : gps.status === 'locating'
          ? `Accurate to ±${r.accuracy_m} m, still improving…`
          : ok ? `Accurate to ±${r.accuracy_m} m. Good.` : `Only ±${r.accuracy_m} m. Step outside and try again.`}
    </p>
  )
}

/** "I'm standing here": take a GPS reading and save it as the place's pin. */
function SetHere({ place, maxAccuracy, onSaved, onCancel }) {
  const gps = useGpsReading()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { start } = gps
  useEffect(() => {
    start()
  }, [start])
  const r = gps.reading
  const ok = r && r.accuracy_m <= maxAccuracy

  async function save() {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest(`/api/v1/admin/pins/places/${place.id}/on-site`, {
        method: 'POST', body: JSON.stringify(r),
      })
      onSaved(`${place.name}: pin saved${result.moved_m != null ? `, moved ${result.moved_m} m` : ''}. `
        + (result.prices.prices ? `${result.prices.prices} route prices updated.`
          : 'Prices will be worked out once nearby places have pins too.'))
    } catch (err) {
      setError(err.message || 'Could not save the pin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-outline stack stack-sm" style={{ padding: 12 }}>
      <p className="small"><strong>Stand right at {place.name}</strong> (at the gate, junction or sign people know), outdoors if you can.</p>
      <GpsReadout gps={gps} maxAccuracy={maxAccuracy} />
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="button" className="btn btn-sm btn-primary" disabled={!ok || busy} onClick={save}>
          <MapPin size={16} aria-hidden="true" /> {busy ? 'Saving…' : 'Save this as the pin'}
        </button>
        {gps.status !== 'locating' && <button type="button" className="btn btn-sm" onClick={gps.start}>Try again</button>}
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function PlaceCard({ place, maxAccuracy, onDone }) {
  const [mode, setMode] = useState(null) // here | map
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function post(path, message) {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest(path, { method: 'POST' })
      onDone(typeof message === 'function' ? message(result) : message)
    } catch (err) {
      setError(err.message || 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  const s = place.suggestion
  const markers = [
    ...(place.latitude != null ? [{ id: 'pin', latitude: place.latitude, longitude: place.longitude, kind: 'pickup', title: 'Current pin' }] : []),
    ...(s ? [{ id: 'trips', latitude: s.latitude, longitude: s.longitude, kind: 'destination', title: 'Where trips happen' }] : []),
  ]
  const onlyGuessed = place.latitude != null && place.flags.every((f) => f.key === 'guessed')

  return (
    <article className="card stack stack-sm pin-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title">{place.name}</h3>
          <p className="muted small">{place.zone.name} · {place.area.name}{place.status === 'pending' ? ' · not live yet' : ''}</p>
        </div>
        {place.checked && <span className="badge badge-green">Checked</span>}
      </div>
      {place.flags.length > 0 && (
        <div className="chip-row">
          {place.flags.map((f) => <span key={f.key} className={`chip is-static pin-flag pin-flag-${f.key}`}>{f.text}</span>)}
        </div>
      )}
      <p className="muted small">
        {place.latitude == null ? 'No pin on the map.' : SOURCE[place.pin_source] || 'Placed by staff'}
        {place.shared_with.length > 0 && <> · same spot as {place.shared_with.join(', ')}</>}
        {place.trip_readings > 0 && <> · {place.trip_readings} trip reading{place.trip_readings === 1 ? '' : 's'}</>}
      </p>
      {s && place.flags.some((f) => f.key === 'trips_disagree') && (
        <p className="small">
          <Navigation size={14} aria-hidden="true" /> {s.samples} trips started or ended about{' '}
          <strong>{s.meters_from_pin != null ? `${s.meters_from_pin} m` : 'somewhere'}</strong> from this pin.
        </p>
      )}
      <Alert tone="error">{error}</Alert>
      {mode === 'here' && (
        <SetHere place={place} maxAccuracy={maxAccuracy} onCancel={() => setMode(null)}
          onSaved={(msg) => { setMode(null); onDone(msg) }} />
      )}
      {mode === 'map' && markers.length > 0 && (
        <div className="stack stack-sm">
          <LazyMap markers={markers} height={220} follow label={`Map of ${place.name}`} />
          {s && <p className="muted small">Green: current pin. Red: where trips really happen.</p>}
        </div>
      )}
      {mode !== 'here' && (
        <div className="row">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setMode('here')}>
            <Crosshair size={16} aria-hidden="true" /> I’m here: set pin
          </button>
          {s && place.flags.some((f) => f.key === 'trips_disagree') && (
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => post(`/api/v1/admin/pins/places/${place.id}/use-trips`,
                (r) => `${place.name}: moved to where trips happen. ${r.prices.prices} route prices updated.`)}>
              Use trip location
            </button>
          )}
          {onlyGuessed && (
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => post(`/api/v1/admin/pins/places/${place.id}/confirm`, `${place.name}: pin confirmed.`)}>
              <Check size={16} aria-hidden="true" /> Pin is right
            </button>
          )}
          {markers.length > 0 && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setMode(mode === 'map' ? null : 'map')}>
              {mode === 'map' ? 'Hide map' : 'View map'}
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function AddHere({ zones, areas, maxAccuracy, onDone, onCancel }) {
  const gps = useGpsReading()
  const [nearby, setNearby] = useState([])
  const [form, setForm] = useState({ name: '', zone_id: '', service_area_id: '', place_type: 'landmark' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { start } = gps
  useEffect(() => {
    start()
  }, [start])
  const r = gps.reading
  const ok = r && r.accuracy_m <= maxAccuracy
  const done = gps.status === 'done'

  useEffect(() => {
    if (!done || !r) return
    apiRequest(`/api/v1/admin/pins/nearby?latitude=${r.latitude}&longitude=${r.longitude}`)
      .then((data) => {
        setNearby(data.places || [])
        const first = data.places?.[0]
        if (first) {
          setForm((f) => ({ ...f, zone_id: f.zone_id || String(first.zone_id),
            service_area_id: f.service_area_id || String(first.service_area_id) }))
        }
      })
      .catch(() => {})
  }, [done, r])

  async function save(event) {
    event.preventDefault()
    if (form.name.trim().length < 3) return setError('Enter the name people use for this place.')
    if (!form.zone_id) return setError('Choose the zone.')
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/admin/pins/places', {
        method: 'POST',
        body: JSON.stringify({ ...r, name: form.name.trim(), zone_id: Number(form.zone_id),
          service_area_id: form.service_area_id ? Number(form.service_area_id) : null, place_type: form.place_type }),
      })
      onDone(`${result.name} added with ${result.prices} route prices. Riders can book it now.`)
    } catch (err) {
      setError(err.message || 'Could not add the place.')
    } finally {
      setBusy(false)
    }
  }

  const close = nearby.filter((p) => p.meters <= 60)
  return (
    <form className="card stack" onSubmit={save} aria-labelledby="add-here-title">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <h2 id="add-here-title" className="card-title pin-head-title"><Plus size={18} aria-hidden="true" /> Add a place where I’m standing</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}><X size={18} /></button>
      </div>
      <GpsReadout gps={gps} maxAccuracy={maxAccuracy} />
      {close.length > 0 && (
        <Alert tone="warning">
          Already listed close by: {close.map((p) => `${p.name} (${p.meters} m)`).join(', ')}. If it’s the same place,
          cancel and use “I’m here: set pin” on it instead.
        </Alert>
      )}
      <label className="field" htmlFor="here-name">
        <span className="field-label">Name people use</span>
        <input id="here-name" className="input" maxLength={120} value={form.name} placeholder="e.g. Mercy Pharmacy, Okesa"
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </label>
      <div className="form-grid">
        <label className="field" htmlFor="here-zone">
          <span className="field-label">Zone</span>
          <select id="here-zone" className="select" value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })} required>
            <option value="">Choose…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="here-type">
          <span className="field-label">Type</span>
          <select id="here-type" className="select" value={form.place_type} onChange={(e) => setForm({ ...form, place_type: e.target.value })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {areas.length > 1 && (
        <label className="field" htmlFor="here-area">
          <span className="field-label">Service area</span>
          <select id="here-area" className="select" value={form.service_area_id} onChange={(e) => setForm({ ...form, service_area_id: e.target.value })}>
            <option value="">Same as the nearest place</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={!ok || busy}>{busy ? 'Adding…' : 'Add place here'}</button>
        {gps.status !== 'locating' && <button type="button" className="btn btn-sm" onClick={gps.start}>Read location again</button>}
      </div>
    </form>
  )
}

function SuggestionCard({ item, zones, areas, onDone }) {
  const [form, setForm] = useState({
    name: item.name, zone_id: item.nearest_place ? String(item.nearest_place.zone_id) : '',
    service_area_id: item.nearest_place ? String(item.nearest_place.service_area_id) : '', place_type: 'landmark',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [map, setMap] = useState(false)

  async function act(kind) {
    if (kind === 'approve' && !form.zone_id) return setError('Choose the zone.')
    setBusy(true)
    setError('')
    try {
      const body = kind === 'approve' ? JSON.stringify({ name: form.name.trim(), zone_id: Number(form.zone_id),
        service_area_id: form.service_area_id ? Number(form.service_area_id) : null, place_type: form.place_type }) : undefined
      await apiRequest(`/api/v1/admin/pins/suggestions/${item.id}/${kind}`, { method: 'POST', body })
      onDone(kind === 'approve' ? `${form.name.trim()} added to the list. The riders who suggested it have been told.` : 'Suggestion rejected.')
    } catch (err) {
      setError(err.message || 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card stack stack-sm">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="card-title">{item.name}</h3>
        <span className="badge badge-gold">{item.suggested_by} rider{item.suggested_by === 1 ? '' : 's'}</span>
      </div>
      {item.other_names.length > 0 && <p className="muted small">Also called: {item.other_names.join(', ')}</p>}
      {item.nearest_place && (
        <p className={`small ${item.nearest_place.meters <= 60 ? 'text-warn' : 'muted'}`}>
          Nearest listed place: {item.nearest_place.name}, {item.nearest_place.meters} m away
          {item.nearest_place.meters <= 60 ? '. It might already be on the list.' : '.'}
        </p>
      )}
      <p className="muted small">Only add public spots (shops, schools, junctions, churches). Reject homes and private compounds.</p>
      {map && <LazyMap markers={[{ id: 's', latitude: item.latitude, longitude: item.longitude, kind: 'pickup', title: item.name }]} height={200} follow label={`Map of ${item.name}`} />}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Zone</span>
          <select className="select" value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })}>
            <option value="">Choose…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      </div>
      {areas.length > 1 && (
        <label className="field">
          <span className="field-label">Service area</span>
          <select className="select" value={form.service_area_id} onChange={(e) => setForm({ ...form, service_area_id: e.target.value })}>
            <option value="">Same as the nearest place</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <Alert tone="error">{error}</Alert>
      <div className="row">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => act('approve')}>Add to the list</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act('reject')}>Reject</button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setMap(!map)}>{map ? 'Hide map' : 'View map'}</button>
      </div>
    </article>
  )
}

/** Keep every place's pin accurate: fares are worked out from the distance between pins. */
export default function AdminPinsPage() {
  const [tab, setTab] = useState('attention')
  const [query, setQuery] = useState('')
  const [data, setData] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const view = tab === 'suggestions' ? 'attention' : tab
      const [pins, sugg] = await Promise.all([
        apiRequest(`/api/v1/admin/pins?view=${view}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`),
        apiRequest('/api/v1/admin/pins/suggestions'),
      ])
      setData(pins)
      setSuggestions(sugg.suggestions || [])
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load the places.')
    }
  }, [tab, query])

  useEffect(() => {
    const timer = window.setTimeout(load, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const done = (msg) => {
    setMessage(msg)
    setAdding(false)
    load()
  }

  const summary = data?.summary
  const max = data?.max_accuracy_m || 50
  const counts = useMemo(() => ({
    attention: summary?.attention, all: summary?.total, checked: summary?.checked, suggestions: suggestions.length,
  }), [summary, suggestions])

  return (
    <AdminShell eyebrow="Places" title="Pin check"
      description="Fares come from the road distance between pins, so every pin needs to be on the right spot. Fix the flagged ones, ideally by standing at the place.">
      <div className="stack">
        {summary && (
          <div className="pin-stats">
            <div><strong>{summary.attention}</strong><span>need attention</span></div>
            <div><strong>{summary.checked}</strong><span>checked</span></div>
            <div><strong>{summary.total}</strong><span>places</span></div>
            <div><strong>{suggestions.length}</strong><span>rider suggestions</span></div>
          </div>
        )}
        <Alert tone="success">{message}</Alert>
        <Alert tone="error">{error}</Alert>
        {adding ? (
          <AddHere zones={data?.zones || []} areas={data?.areas || []} maxAccuracy={max} onDone={done} onCancel={() => setAdding(false)} />
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setMessage('') }}>
              <MapPinned size={18} aria-hidden="true" /> Add a place where I’m standing
            </button>
          </div>
        )}
        <div className="chip-row" role="tablist" aria-label="Which places">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key}
              className={`chip ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
              {label}{counts[key] != null ? ` (${counts[key]})` : ''}
            </button>
          ))}
        </div>
        {tab !== 'suggestions' && (
          <label className="field search-field" htmlFor="pin-search">
            <span className="sr-only">Search places</span>
            <Search size={16} aria-hidden="true" />
            <input id="pin-search" className="input" type="search" placeholder="Search a place or zone"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {tab === 'suggestions' ? (
          suggestions.length ? (
            <div className="pin-grid">
              {suggestions.map((item) => (
                <SuggestionCard key={item.id} item={item} zones={data?.zones || []} areas={data?.areas || []} onDone={done} />
              ))}
            </div>
          ) : <p className="muted">No suggestions waiting. Riders can suggest a spot when they drop a pin.</p>
        ) : data && (
          data.places.length ? (
            <div className="pin-grid">
              {data.places.map((place) => (
                <PlaceCard key={`${place.id}-${place.latitude}-${place.flags.length}`} place={place} maxAccuracy={max} onDone={done} />
              ))}
            </div>
          ) : <p className="muted">{tab === 'attention' ? 'Every pin looks right. Nice work.' : 'No places match.'}</p>
        )}
      </div>
    </AdminShell>
  )
}
