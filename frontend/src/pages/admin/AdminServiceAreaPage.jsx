import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Check, Eraser, Save, Trash2, Undo2 } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import Select from '../../components/ui/Select.jsx'
import { apiRequest } from '../../services/authService.js'
import { getMapConfig } from '../../services/tripService.js'

const BASE = '/api/v1/admin/service-areas'
const FALLBACK = {
  tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  center: { latitude: 7.6233, longitude: 5.2214 },
}
// A calmer map style for this page when Geoapify tiles are on.
const calm = (config) => ({ ...config, tile_url: config.tile_url.replace('/osm-bright/', '/positron/') })
const CHOICES = [
  [1, 'Close to my places', 'About a short walk around each place'],
  [2, 'Nearby', 'Recommended: covers the streets around town'],
  [3, 'Wider', 'Reaches the edges of town'],
  [5, 'Far', 'Includes nearby villages and junctions'],
]
const cornerIcon = (n) => L.divIcon({ className: '', html: `<span class="sa-corner">${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] })
const placeIcon = L.divIcon({ className: '', html: '<span class="sa-place"></span>', iconSize: [12, 12], iconAnchor: [6, 6] })

/** A still picture of the area: shaded shape and the places, nothing to tap or drag. */
function PreviewMap({ config, places, shape }) {
  const box = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)

  useEffect(() => {
    if (!box.current || map.current) return undefined
    map.current = L.map(box.current, {
      zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false, tap: false,
    }).setView([config.center.latitude, config.center.longitude], 12)
    L.tileLayer(config.tile_url, { attribution: config.attribution, maxZoom: 19 }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [config])

  useEffect(() => {
    if (!layer.current) return
    layer.current.clearLayers()
    if (shape?.length >= 3) {
      L.polygon(shape, { color: '#0E4D3B', weight: 3, fillColor: '#F2B33D', fillOpacity: 0.28 }).addTo(layer.current)
    }
    places.forEach((p) => L.marker([p.latitude, p.longitude], { icon: placeIcon, interactive: false }).addTo(layer.current))
    const pts = [...(shape || []), ...places.map((p) => [p.latitude, p.longitude])]
    if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 15, animate: false })
  }, [places, shape])

  return <div ref={box} className="sa-map sa-preview" role="img" aria-label="The shaded area is where passengers can drop a pin." />
}

/** Tap the map to add corners in order around the edge; drag a corner to move it. */
function BoundaryMap({ config, places, corners, setCorners }) {
  const box = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const fitted = useRef(false)

  useEffect(() => {
    if (!box.current || map.current) return undefined
    map.current = L.map(box.current, { scrollWheelZoom: false })
      .setView([config.center.latitude, config.center.longitude], 13)
    L.tileLayer(config.tile_url, { attribution: config.attribution, maxZoom: 19 }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    map.current.on('click', (e) => setCorners((c) => [...c, [Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]]))
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [config, setCorners])

  useEffect(() => {
    if (!layer.current) return
    layer.current.clearLayers()
    places.forEach((p) => L.marker([p.latitude, p.longitude], { icon: placeIcon, title: p.name, interactive: false }).addTo(layer.current))
    if (corners.length >= 2) {
      L.polygon(corners, { color: '#0E4D3B', weight: 3, fillColor: '#F2B33D', fillOpacity: corners.length >= 3 ? 0.18 : 0 })
        .addTo(layer.current)
    }
    corners.forEach((c, i) => {
      const m = L.marker(c, { icon: cornerIcon(i + 1), draggable: true, title: `Corner ${i + 1}` }).addTo(layer.current)
      m.on('dragend', (e) => {
        const ll = e.target.getLatLng()
        setCorners((all) => all.map((x, j) => (j === i ? [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))] : x)))
      })
    })
    if (!fitted.current) {
      const pts = [...places.map((p) => [p.latitude, p.longitude]), ...corners]
      if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 })
      fitted.current = true
    }
  }, [places, corners, setCorners])

  return <div ref={box} className="sa-map" role="application" aria-label="Service area map. Tap to add a corner." />
}

export default function AdminServiceAreaPage() {
  const [areas, setAreas] = useState([])
  const [areaId, setAreaId] = useState('')
  const [km, setKm] = useState(2)
  const [corners, setCorners] = useState([])
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const area = areas.find((a) => String(a.id) === String(areaId))

  function choose(row) {
    setAreaId(String(row.id))
    setKm(row.mode === 'auto' ? row.auto_km : 2)
    setCorners(row.mode === 'drawn' ? row.corners || [] : [])
  }

  useEffect(() => {
    let active = true
    apiRequest(BASE)
      .then((rows) => {
        if (!active) return
        setAreas(rows)
        const pick = rows.find((a) => a.status === 'active') || rows[0]
        if (pick) choose(pick)
      })
      .catch((err) => active && setError(err.message || 'Could not load the service areas.'))
    getMapConfig().then((c) => active && setConfig(calm(c))).catch(() => active && setConfig(FALLBACK))
    return () => {
      active = false
    }
  }, [])

  async function save(body, done) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const row = await apiRequest(`${BASE}/${areaId}/boundary`, { method: 'PUT', body: JSON.stringify(body) })
      setAreas((all) => all.map((a) => (a.id === row.id ? { ...row, fallback_km: a.fallback_km } : a)))
      choose(row)
      setNotice(done)
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const shape = area?.previews?.[String(Number(km).toFixed(1))] || []
  const autoSaved = area?.mode === 'auto' && Number(area.auto_km) === Number(km)
  const drawnSaved = area?.mode === 'drawn' && JSON.stringify(area.corners || []) === JSON.stringify(corners)

  return (
    <AdminShell title="Service area" description="Choose how far around your places passengers can drop a pin. Outside this area, they’re told EkiMove doesn’t serve that spot yet.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>
        {areas.length > 1 && (
          <label className="field" htmlFor="sa-area">
            <span className="field-label">Town</span>
            <Select id="sa-area" value={areaId} onChange={(e) => choose(areas.find((a) => String(a.id) === e.target.value))}>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== 'active' ? ` (${a.status})` : ''}</option>)}
            </Select>
          </label>
        )}
        {area && (
          <>
            <p className="sa-now">
              <strong>Right now: </strong>
              {area.mode === 'auto' && `everything within ${area.auto_km} km of your ${area.places.length} places. It updates by itself when you add places.`}
              {area.mode === 'drawn' && `the edge you drew by hand (${area.corners?.length} corners).`}
              {!area.mode && `not set, so pins are accepted within ${area.fallback_km} km of your places.`}
            </p>

            <section className="card stack" aria-labelledby="sa-choose">
              <h2 id="sa-choose" className="section-title">How far around your places?</h2>
              {area.places.length === 0 ? (
                <Alert tone="warning">None of {area.name}’s places has a map pin yet. Pin them in Pin check first.</Alert>
              ) : (
                <>
                  <div className="sa-choices" role="radiogroup" aria-label="Distance around your places">
                    {CHOICES.map(([value, title, hint]) => (
                      <label key={value} className={`sa-choice ${Number(km) === value ? 'is-on' : ''}`}>
                        <input type="radio" name="sa-km" value={value} checked={Number(km) === value} onChange={() => setKm(value)} />
                        <span className="sa-choice-km">{value} km</span>
                        <span className="sa-choice-title">{title}</span>
                        <span className="sa-choice-hint">{hint}</span>
                      </label>
                    ))}
                  </div>
                  {config && <PreviewMap config={config} places={area.places} shape={shape} />}
                  <p className="muted small">
                    Shaded: where passengers can drop a pin. Green dots: your {area.places.length} places.
                    {area.unpinned_places > 0 && ` ${area.unpinned_places} place${area.unpinned_places === 1 ? ' has' : 's have'} no map pin yet and isn’t counted.`}
                  </p>
                  <button type="button" className="btn btn-primary" disabled={busy || autoSaved}
                    onClick={() => save({ auto_km: Number(km) }, `Done. Passengers can drop a pin within ${km} km of your places.`)}>
                    <Check size={18} aria-hidden="true" /> {busy ? 'Saving…' : autoSaved ? 'This is your area' : 'Use this area'}
                  </button>
                </>
              )}
            </section>

            <details className="card sa-advanced">
              <summary>Advanced: draw the edge yourself</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <p className="muted small">
                  Only if the automatic area doesn’t fit. Tap the map to add corners in order around the edge of town;
                  drag a numbered corner to move it.
                </p>
                {config && <BoundaryMap key={`draw-${areaId}`} config={config} places={area.places} corners={corners} setCorners={setCorners} />}
                {area.mode === 'drawn' && area.places_outside?.length > 0 && drawnSaved && (
                  <Alert tone="warning">Outside the edge: {area.places_outside.join(', ')}.</Alert>
                )}
                <div className="row sa-actions">
                  <button type="button" className="btn btn-primary" disabled={busy || corners.length < 3 || drawnSaved}
                    onClick={() => save({ corners }, 'Saved the edge you drew.')}>
                    <Save size={18} aria-hidden="true" /> {drawnSaved ? 'Saved' : 'Save my drawing'}
                  </button>
                  <button type="button" className="btn" onClick={() => setCorners((c) => c.slice(0, -1))} disabled={busy || !corners.length}>
                    <Undo2 size={18} aria-hidden="true" /> Undo corner
                  </button>
                  <button type="button" className="btn" onClick={() => setCorners([])} disabled={busy || !corners.length}>
                    <Eraser size={18} aria-hidden="true" /> Clear
                  </button>
                </div>
              </div>
            </details>

            {area.mode && (
              <button type="button" className="btn btn-danger-outline btn-sm sa-reset" disabled={busy}
                onClick={() => save({ corners: null }, `Removed. Pins are accepted within ${area.fallback_km} km of your places again.`)}>
                <Trash2 size={16} aria-hidden="true" /> Go back to the {area.fallback_km} km rule
              </button>
            )}
          </>
        )}
      </div>
    </AdminShell>
  )
}
