import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Eraser, Save, Trash2, Undo2 } from 'lucide-react'
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
const cornerIcon = (n) => L.divIcon({ className: '', html: `<span class="sa-corner">${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] })
const placeIcon = L.divIcon({ className: '', html: '<span class="sa-place"></span>', iconSize: [12, 12], iconAnchor: [6, 6] })

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
  const [corners, setCorners] = useState([])
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const area = areas.find((a) => String(a.id) === String(areaId))

  useEffect(() => {
    let active = true
    apiRequest(BASE)
      .then((rows) => {
        if (!active) return
        setAreas(rows)
        const pick = rows.find((a) => a.status === 'active') || rows[0]
        if (pick) {
          setAreaId(String(pick.id))
          setCorners(pick.corners || [])
        }
      })
      .catch((err) => active && setError(err.message || 'Could not load the service areas.'))
    getMapConfig().then((c) => active && setConfig(c)).catch(() => active && setConfig(FALLBACK))
    return () => {
      active = false
    }
  }, [])

  async function save(remove = false) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const row = await apiRequest(`${BASE}/${areaId}/boundary`, {
        method: 'PUT', body: JSON.stringify({ corners: remove ? null : corners }),
      })
      setAreas((all) => all.map((a) => (a.id === row.id ? { ...row, fallback_km: a.fallback_km } : a)))
      setCorners(row.corners || [])
      setNotice(remove
        ? 'Boundary removed. Pins are accepted within 8 km of this area’s places again.'
        : `Saved. Pins outside this boundary are now refused (${row.area_km2} km² covered).`)
    } catch (err) {
      setError(err.message || 'Could not save the boundary.')
    } finally {
      setBusy(false)
    }
  }

  const saved = JSON.stringify(area?.corners || []) === JSON.stringify(corners)

  return (
    <AdminShell title="Service area" description="Draw the edge of where EkiMove serves. Dropped pins inside it are accepted; outside it, passengers are told you don’t serve that spot yet.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>
        {areas.length > 1 && (
          <label className="field" htmlFor="sa-area">
            <span className="field-label">Area</span>
            <Select id="sa-area" value={areaId} onChange={(e) => {
              const next = areas.find((a) => String(a.id) === e.target.value)
              setAreaId(e.target.value)
              setCorners(next?.corners || [])
            }}>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== 'active' ? ` (${a.status})` : ''}</option>)}
            </Select>
          </label>
        )}
        {area && (
          <section className="card stack">
            <p className="small">
              {area.corners
                ? <><strong>Boundary drawn:</strong> {area.corners.length} corners, {area.area_km2} km². Pins outside it are refused.</>
                : <><strong>Not drawn yet:</strong> pins are accepted within {area.fallback_km} km of this area’s places
                  {area.places.length ? ` (${area.places.length} with map pins)` : ' (none has a map pin yet)'}.</>}
            </p>
            <p className="muted small">
              Tap the map to add corners in order, going round the edge of town. Drag a numbered corner to move it.
              The green dots are your listed places; keep them inside.
            </p>
            {config && <BoundaryMap key={areaId} config={config} places={area.places} corners={corners} setCorners={setCorners} />}
            {area.places_outside?.length > 0 && saved && (
              <Alert tone="warning">
                Outside the boundary: {area.places_outside.join(', ')}. Move a corner so they’re inside, unless you
                no longer serve them.
              </Alert>
            )}
            <div className="row sa-actions">
              <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={busy || corners.length < 3 || saved}>
                <Save size={18} aria-hidden="true" /> {busy ? 'Saving…' : saved && area.corners ? 'Saved' : 'Save boundary'}
              </button>
              <button type="button" className="btn" onClick={() => setCorners((c) => c.slice(0, -1))} disabled={busy || !corners.length}>
                <Undo2 size={18} aria-hidden="true" /> Undo corner
              </button>
              <button type="button" className="btn" onClick={() => setCorners([])} disabled={busy || !corners.length}>
                <Eraser size={18} aria-hidden="true" /> Clear
              </button>
              {area.corners && (
                <button type="button" className="btn btn-danger-outline" onClick={() => save(true)} disabled={busy}>
                  <Trash2 size={18} aria-hidden="true" /> Remove boundary
                </button>
              )}
            </div>
            <p className="muted small">{corners.length} corner{corners.length === 1 ? '' : 's'}{!saved ? ' · not saved yet' : ''}</p>
          </section>
        )}
      </div>
    </AdminShell>
  )
}
