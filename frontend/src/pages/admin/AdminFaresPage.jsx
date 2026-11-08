import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, MapPinned, Plus, Ruler, Trash2, Wand2 } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import Select from '../../components/ui/Select.jsx'
import { apiRequest } from '../../services/authService.js'

const BASE = '/api/v1/admin/fare-calculator'
const naira = (value) => `₦${Math.round(Number(value || 0)).toLocaleString('en-NG')}`
const ACTION = {
  new: ['New', 'is-new'], change: ['Changes', 'is-change'], same: ['No change', 'is-same'], manual: ['Set by hand', 'is-manual'],
}
const PAGE = 60
const routeKey = (route, vehicle) => `${route.origin.id}|${route.destination.id}|${vehicle}`

function NumberField({ label, value, onChange, prefix = '₦' }) {
  return (
    <label className="field fc-num">
      <span className="field-label">{label}</span>
      <span className="fc-num-wrap">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input className="input" inputMode="numeric" value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} />
      </span>
    </label>
  )
}

function FormulaCard({ formula, draft, setDraft, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(formula)
  const setVehicle = (i, key, value) => setDraft((d) => ({
    ...d, vehicles: d.vehicles.map((v, j) => (j === i ? { ...v, [key]: value } : v)),
  }))

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = {
        road_factor: Number(draft.road_factor),
        vehicles: draft.vehicles.map((v) => ({
          ...v, base: Number(v.base || 0), per_km: Number(v.per_km || 0), minimum: Number(v.minimum || 0),
          round_to: Math.max(1, Number(v.round_to || 1)), extra_passenger: Number(v.extra_passenger || 0),
        })),
      }
      await apiRequest(`${BASE}/formula`, { method: 'PUT', body: JSON.stringify(body) })
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="fc-formula">
      <div className="fc-head">
        <h2 id="fc-formula" className="section-title"><Calculator size={18} aria-hidden="true" /> Price formula</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : dirty ? 'Save formula' : 'Saved'}
        </button>
      </div>
      <p className="muted small">Price = starting fare + (price per km × road distance), never below the minimum, rounded to the nearest step.</p>
      <Alert tone="error">{error}</Alert>
      <div className="fc-vehicles">
        {draft.vehicles.map((v, i) => (
          <fieldset key={v.vehicle_type} className={`fc-vehicle ${v.enabled ? '' : 'is-off'}`}>
            <legend>
              <label className="check-row">
                <input type="checkbox" checked={v.enabled} onChange={(event) => setVehicle(i, 'enabled', event.target.checked)} />
                {v.label}
              </label>
            </legend>
            <div className="fc-grid">
              <NumberField label="Starting fare" value={String(v.base)} onChange={(x) => setVehicle(i, 'base', x)} />
              <NumberField label="Per km" value={String(v.per_km)} onChange={(x) => setVehicle(i, 'per_km', x)} />
              <NumberField label="Minimum fare" value={String(v.minimum)} onChange={(x) => setVehicle(i, 'minimum', x)} />
              <NumberField label="Round to nearest" value={String(v.round_to)} onChange={(x) => setVehicle(i, 'round_to', x)} />
              {v.vehicle_type !== 'motorcycle' && (
                <NumberField label="Each extra passenger" value={String(v.extra_passenger)}
                  onChange={(x) => setVehicle(i, 'extra_passenger', x)} />
              )}
            </div>
            <p className="muted small">
              Example: 3 km = {naira(Math.max(Number(v.minimum || 0), Math.round(
                (Number(v.base || 0) + Number(v.per_km || 0) * 3) / Math.max(1, Number(v.round_to || 1)),
              ) * Math.max(1, Number(v.round_to || 1))))}
            </p>
          </fieldset>
        ))}
      </div>
    </section>
  )
}

function SuggestCard({ places, formula, onUse }) {
  const vehicles = formula.vehicles.filter((v) => v.enabled)
  const blank = { origin: '', destination: '', vehicle: vehicles[0]?.vehicle_type || 'motorcycle', amount: '' }
  const [rows, setRows] = useState([blank, blank, blank])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const setRow = (i, key, value) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row)))

  async function suggest() {
    const samples = rows.filter((r) => r.origin && r.destination && r.amount).map((r) => ({
      origin_place_id: Number(r.origin), destination_place_id: Number(r.destination),
      vehicle_type: r.vehicle, amount: Number(r.amount),
    }))
    if (!samples.length) {
      setError('Fill in at least one route with today’s price.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setResult(await apiRequest(`${BASE}/suggest`, { method: 'POST', body: JSON.stringify({ samples }) }))
    } catch (err) {
      setError(err.message || 'Could not work it out.')
    } finally {
      setBusy(false)
    }
  }

  const label = (type) => formula.vehicles.find((v) => v.vehicle_type === type)?.label || type
  const name = (id) => places.find((p) => p.id === id)?.name || ''

  return (
    <section className="card stack" aria-labelledby="fc-suggest">
      <h2 id="fc-suggest" className="section-title"><Wand2 size={18} aria-hidden="true" /> Match today’s prices</h2>
      <p className="muted small">
        Enter a few routes and what an okada or car usually charges on them today. EkiMove works out the starting fare
        and per-km price that fit best. Use short and long trips for the best match.
      </p>
      <Alert tone="error">{error}</Alert>
      <div className="fc-samples">
        {rows.map((row, i) => (
          <div key={i} className="fc-sample">
            <Select value={row.origin} onChange={(e) => setRow(i, 'origin', e.target.value)} aria-label={`Example ${i + 1} from`}>
              <option value="">From</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={row.destination} onChange={(e) => setRow(i, 'destination', e.target.value)} aria-label={`Example ${i + 1} to`}>
              <option value="">To</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={row.vehicle} onChange={(e) => setRow(i, 'vehicle', e.target.value)} aria-label={`Example ${i + 1} vehicle`}>
              {vehicles.map((v) => <option key={v.vehicle_type} value={v.vehicle_type}>{v.label}</option>)}
            </Select>
            <span className="fc-num-wrap">
              <span aria-hidden="true">₦</span>
              <input className="input" inputMode="numeric" placeholder="Price" aria-label={`Example ${i + 1} price today`}
                value={row.amount} onChange={(e) => setRow(i, 'amount', e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </span>
            <button type="button" className="icon-btn" aria-label={`Remove example ${i + 1}`} disabled={rows.length < 2}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        {rows.length < 20 && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRows((r) => [...r, blank])}>
            <Plus size={16} aria-hidden="true" /> Add a route
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={suggest} disabled={busy}>{busy ? 'Working it out…' : 'Suggest a formula'}</button>
      </div>
      {result?.suggestions.map((tip) => (
        <div key={tip.vehicle_type} className="fc-tip">
          <p><strong>{label(tip.vehicle_type)}:</strong> starting fare {naira(tip.base)} + {naira(tip.per_km)} per km
            (minimum {naira(tip.minimum)})</p>
          <ul className="plain-list small">
            {tip.examples.map((e, i) => (
              <li key={i}>{name(e.origin_place_id)} → {name(e.destination_place_id)} ({e.km} km): today {naira(e.today)},
                formula {naira(e.with_formula)}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm" onClick={() => onUse(tip)}>Use for {label(tip.vehicle_type)}</button>
        </div>
      ))}
    </section>
  )
}

export default function AdminFaresPage() {
  const [areas, setAreas] = useState([])
  const [areaId, setAreaId] = useState('')
  const [data, setDataRaw] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [onlyChanges, setOnlyChanges] = useState(true)
  const [shown, setShown] = useState(PAGE)
  const [edits, setEdits] = useState({})
  const [replace, setReplace] = useState({})
  const [pinProgress, setPinProgress] = useState('')
  const setData = useCallback((result) => {
    setDataRaw(result)
    setDraft(result.formula)
  }, [])

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/admin/locations/areas')
      .then((list) => {
        if (!active) return
        setAreas(list)
        const first = list.find((a) => a.status === 'active') || list[0]
        if (first) setAreaId(String(first.id))
      })
      .catch((err) => active && setError(err.message || 'Could not load service areas.'))
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async (id) => {
    if (!id) return
    try {
      setData(await apiRequest(`${BASE}?service_area_id=${id}`))
    } catch (err) {
      setError(err.message || 'Could not load the fare calculator.')
    }
  }, [setData])

  useEffect(() => {
    let active = true
    if (areaId) {
      apiRequest(`${BASE}?service_area_id=${areaId}`)
        .then((result) => active && setData(result))
        .catch((err) => active && setError(err.message || 'Could not load the fare calculator.'))
    }
    return () => {
      active = false
    }
  }, [areaId, setData])

  const vehicles = useMemo(() => (data?.formula.vehicles || []).filter((v) => v.enabled), [data])
  const places = useMemo(() => {
    const map = new Map()
    data?.routes.forEach((r) => map.set(r.origin.id, r.origin))
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return data.routes.filter((route) => {
      const text = `${route.origin.name} ${route.destination.name}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) return false
      if (!onlyChanges) return true
      return Object.entries(route.prices).some(([vehicle, p]) =>
        p.action === 'new' || p.action === 'change' || edits[routeKey(route, vehicle)] !== undefined)
    })
  }, [data, query, onlyChanges, edits])

  async function measure(refresh = false) {
    setBusy('measure')
    setError('')
    setNotice('')
    try {
      const result = await apiRequest(`${BASE}/distances`, {
        method: 'POST', body: JSON.stringify({ service_area_id: Number(areaId), refresh }),
      })
      const c = result.counts
      setNotice(result.map_service
        ? `Measured ${c.road} road distance${c.road === 1 ? '' : 's'}${c.estimate ? `; ${c.estimate} estimated (no road found)` : ''}.`
        : `No map service key is set, so ${c.estimate} distances were estimated from the map pins. Add GEOAPIFY_API_KEY on the API for real road distances.`)
      await load(areaId)
    } catch (err) {
      setError(err.message || 'Could not measure distances.')
    } finally {
      setBusy('')
    }
  }

  async function autoPin() {
    setBusy('pins')
    setError('')
    setNotice('')
    const tried = []
    let found = 0
    let missed = []
    try {
      for (let round = 0; round < 40; round += 1) {
        const result = await apiRequest('/api/v1/admin/locations/places/auto-pin', {
          method: 'POST', body: JSON.stringify({ service_area_id: Number(areaId), skip_ids: tried }),
        })
        result.results.forEach((r) => {
          tried.push(r.id)
          if (r.status === 'pinned') found += 1
          if (r.status === 'not_found') missed = [...missed, r.name]
        })
        setPinProgress(`${tried.length} checked`)
        if (!result.remaining || !result.results.length) break
      }
      setNotice(`Found ${found} pin${found === 1 ? '' : 's'} automatically.`
        + (missed.length ? ` Not found on the map: ${missed.join(', ')}. Add those by hand in Places & fares.` : '')
        + (found ? ' Check them below, then press “Measure road distances”.' : ''))
      await load(areaId)
    } catch (err) {
      setError(err.message || 'Could not find pins.')
    } finally {
      setBusy('')
      setPinProgress('')
    }
  }

  async function apply() {
    const editList = Object.entries(edits).filter(([, v]) => v !== '').map(([key, amount]) => {
      const [o, d, vehicle] = key.split('|')
      return { origin_place_id: Number(o), destination_place_id: Number(d), vehicle_type: vehicle, amount: Number(amount) }
    })
    const replaceList = Object.keys(replace).filter((k) => replace[k]).map((key) => {
      const [o, d, vehicle] = key.split('|')
      return { origin_place_id: Number(o), destination_place_id: Number(d), vehicle_type: vehicle }
    })
    const s = data.summary
    if (!window.confirm(`Apply fares for ${data.area.name}? ${s.new} new and ${s.change} changed prices will go live`
      + `${replaceList.length ? `, and ${replaceList.length} hand-set price(s) will be replaced` : ''}.`)) return
    setBusy('apply')
    setError('')
    setNotice('')
    try {
      const result = await apiRequest(`${BASE}/apply`, {
        method: 'POST',
        body: JSON.stringify({ service_area_id: Number(areaId), edits: editList, replace_manual: replaceList }),
      })
      const r = result.result
      setData(result)
      setEdits({})
      setReplace({})
      setNotice(`Done: ${r.created} new, ${r.updated} updated, ${r.kept} hand-set kept. Riders see the new prices now.`)
    } catch (err) {
      setError(err.message || 'Could not apply the fares.')
    } finally {
      setBusy('')
    }
  }

  function useSuggestion(tip) {
    setDraft((d) => ({
      ...d,
      vehicles: d.vehicles.map((v) => (v.vehicle_type === tip.vehicle_type
        ? { ...v, base: tip.base, per_km: tip.per_km, minimum: tip.minimum } : v)),
    }))
    setNotice('Suggestion copied into the formula. Press “Save formula” to use it.')
    document.getElementById('fc-formula')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const pending = Object.values(edits).filter((v) => v !== '').length + Object.values(replace).filter(Boolean).length
  const toApply = data ? data.summary.new + data.summary.change + pending : 0

  return (
    <AdminShell title="Fare calculator"
      description="Price every route from its road distance. Preview everything before it goes live; prices you set by hand are kept.">
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>

      {areas.length > 1 && (
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Service area</span>
          <Select value={areaId} onChange={(e) => {
            setAreaId(e.target.value)
            setEdits({})
            setReplace({})
          }}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === 'active' ? '' : ` (${a.status})`}</option>)}
          </Select>
        </label>
      )}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <section className="card stack" aria-labelledby="fc-pins">
            <h2 id="fc-pins" className="section-title"><MapPinned size={18} aria-hidden="true" /> Map pins and distances</h2>
            <p>
              <strong>{data.places - data.missing_pins.length} of {data.places}</strong> places have a map pin.{' '}
              {data.road_distances} route{data.road_distances === 1 ? '' : 's'} measured by road,{' '}
              {data.estimated_distances} estimated.
            </p>
            {data.missing_pins.length > 0 && (
              <Alert tone="warning">
                {data.missing_pins.length} place{data.missing_pins.length === 1 ? ' has' : 's have'} no pin, so{' '}
                {data.missing_pins.length === 1 ? 'it' : 'they'} can’t be priced yet: {data.missing_pins.map((p) => p.name).join(', ')}.
              </Alert>
            )}
            {data.missing_pins.length > 0 && (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={autoPin} disabled={Boolean(busy)}>
                  <MapPinned size={16} aria-hidden="true" />{' '}
                  {busy === 'pins' ? `Finding pins… ${pinProgress}` : 'Find pins automatically'}
                </button>
                <Link className="small" to="/admin/locations">Or place them by hand in Places & fares</Link>
              </div>
            )}
            {data.auto_pins.length > 0 && (
              <details className="fc-auto-pins">
                <summary>{data.auto_pins.length} pin{data.auto_pins.length === 1 ? ' was' : 's were'} found automatically: please check {data.auto_pins.length === 1 ? 'it' : 'them'}</summary>
                <p className="muted small">
                  Public maps can be wrong for local landmarks. Open each place in Places & fares and move the pin if needed.
                  A wrong pin gives a wrong price.
                </p>
                <ul className="plain-list small">
                  {data.auto_pins.map((p) => <li key={p.id}><strong>{p.name}</strong>: {p.label}</li>)}
                </ul>
              </details>
            )}
            {!data.map_service && (
              <p className="muted small">
                Distances are estimated from the pins (straight line × {data.formula.road_factor}). For real road distances,
                add a free Geoapify key as GEOAPIFY_API_KEY on the API.
              </p>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => measure(false)} disabled={Boolean(busy)}>
                <Ruler size={16} aria-hidden="true" /> {busy === 'measure' ? 'Measuring…' : 'Measure road distances'}
              </button>
              {data.road_distances > 0 && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => measure(true)} disabled={Boolean(busy)}>
                  Measure all again
                </button>
              )}
            </div>
          </section>

          {draft && <FormulaCard formula={data.formula} draft={draft} setDraft={setDraft}
            onSaved={() => {
              setNotice('Formula saved. Check the preview below, then apply.')
              load(areaId)
            }} />}

          {places.length >= 2 && <SuggestCard places={places} formula={data.formula} onUse={useSuggestion} />}

          <section className="card stack" aria-labelledby="fc-preview">
            <div className="fc-head">
              <h2 id="fc-preview" className="section-title">Preview ({data.routes.length} routes)</h2>
              <button type="button" className="btn btn-gold btn-sm" onClick={apply}
                disabled={Boolean(busy) || toApply === 0}>
                {busy === 'apply' ? 'Applying…' : `Apply ${toApply} price${toApply === 1 ? '' : 's'}`}
              </button>
            </div>
            <p className="muted small">
              {data.summary.new} new · {data.summary.change} changing · {data.summary.same} unchanged ·{' '}
              {data.summary.manual} set by hand (kept unless you tick “Replace”). Type in a price to set it by hand.
            </p>
            <div className="fc-filters">
              <input className="input" type="search" placeholder="Find a route" value={query} maxLength={60}
                aria-label="Find a route" onChange={(e) => {
                  setQuery(e.target.value)
                  setShown(PAGE)
                }} />
              <label className="check-row">
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
                Only new and changing
              </label>
            </div>
            {filtered.length === 0 && <p className="muted">No routes to show.</p>}
            <ul className="fc-routes">
              {filtered.slice(0, shown).map((route) => (
                <li key={`${route.origin.id}-${route.destination.id}`} className="fc-route">
                  <p className="fc-route-name">
                    <strong>{route.origin.name} → {route.destination.name}</strong>{' '}
                    <span className="muted small">{route.km} km{route.distance_source === 'estimate' ? ' (estimated)' : ''}</span>
                  </p>
                  <div className="fc-prices">
                    {vehicles.map((v) => {
                      const p = route.prices[v.vehicle_type]
                      if (!p) return null
                      const key = routeKey(route, v.vehicle_type)
                      const [text, cls] = ACTION[p.action]
                      return (
                        <div key={v.vehicle_type} className={`fc-price ${cls}`}>
                          <span className="fc-price-label">{v.label}</span>
                          <span className="fc-num-wrap">
                            <span aria-hidden="true">₦</span>
                            <input className="input input-sm" inputMode="numeric"
                              aria-label={`${v.label} price, ${route.origin.name} to ${route.destination.name}`}
                              placeholder={String(Math.round(Number(p.action === 'manual' ? p.current : p.calculated)))}
                              value={edits[key] ?? ''}
                              onChange={(e) => setEdits((x) => ({ ...x, [key]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
                          </span>
                          <span className="fc-tag">
                            {text}{p.action === 'change' && ` from ${naira(p.current)}`}
                            {p.action === 'manual' && ` · formula ${naira(p.calculated)}`}
                          </span>
                          {p.action === 'manual' && (
                            <label className="check-row small">
                              <input type="checkbox" checked={Boolean(replace[key])}
                                onChange={(e) => setReplace((x) => ({ ...x, [key]: e.target.checked }))} />
                              Replace
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({filtered.length - shown} left)
              </button>
            )}
          </section>
        </>
      )}
    </AdminShell>
  )
}
