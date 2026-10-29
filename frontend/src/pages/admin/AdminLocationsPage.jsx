import { useCallback, useEffect, useState } from 'react'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

const emptyArea = { name: '', slug: '', description: '', status: 'draft' }
const emptyPlace = {
  service_area_id: '', zone_id: '', name: '', place_type: 'landmark',
  address_text: '', aliases: '', latitude: '', longitude: '', notes: '',
  status: 'pending',
}
const emptyFare = {
  origin_place_id: '', destination_place_id: '', vehicle_type: 'car',
  base_amount: '0', vehicle_multiplier: '1.000',
  extra_passenger_amount: '0', is_active: false,
}

const money = (value) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', maximumFractionDigits: 2,
  }).format(Number(value || 0))

export default function AdminLocationsPage() {
  const [tab, setTab] = useState('areas')
  const [areas, setAreas] = useState([])
  const [places, setPlaces] = useState([])
  const [fares, setFares] = useState([])
  const [zones, setZones] = useState([])
  const [zoneForm, setZoneForm] = useState({ name: '', is_active: false })
  const [editingZone, setEditingZone] = useState(null)
  const [areaForm, setAreaForm] = useState(emptyArea)
  const [placeForm, setPlaceForm] = useState(emptyPlace)
  const [fareForm, setFareForm] = useState(emptyFare)
  const [editingArea, setEditingArea] = useState(null)
  const [editingPlace, setEditingPlace] = useState(null)
  const [editingFare, setEditingFare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [a, p, f, z] = await Promise.all([
        apiRequest('/api/v1/admin/locations/areas?include_inactive=true'),
        apiRequest('/api/v1/admin/locations/places?include_inactive=true'),
        apiRequest('/api/v1/admin/locations/place-fares?include_inactive=true'),
        apiRequest('/api/v1/admin/zones'),
      ])
      setAreas(a)
      setPlaces(p)
      setFares(f)
      setZones(z)
    } catch (e) {
      setError(e.message || 'Unable to load location management data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const runSave = async (action) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice('Saved successfully.')
      await loadData()
    } catch (e) {
      setError(e.message || 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  const saveZone = (e) => {
    e.preventDefault()
    const name = zoneForm.name.trim()
    if (name.length < 2 || name.length > 100) {
      setError('Zone name must contain between 2 and 100 characters.')
      return
    }

    runSave(async () => {
      await apiRequest(
        editingZone
          ? `/api/v1/admin/zones/${editingZone}`
          : '/api/v1/admin/zones',
        {
          method: editingZone ? 'PATCH' : 'POST',
          body: JSON.stringify({ name, is_active: zoneForm.is_active }),
        },
      )
      setEditingZone(null)
      setZoneForm({ name: '', is_active: false })
    })
  }

  const editZone = (zone) => {
    setEditingZone(zone.id)
    setZoneForm({ name: zone.name, is_active: Boolean(zone.is_active) })
    setTab('zones')
  }

  const saveArea = (e) => {
    e.preventDefault()
    const payload = {
      ...areaForm,
      slug: areaForm.slug.trim() || null,
      description: areaForm.description.trim() || null,
    }
    runSave(async () => {
      await apiRequest(
        editingArea
          ? `/api/v1/admin/locations/areas/${editingArea}`
          : '/api/v1/admin/locations/areas',
        { method: editingArea ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      setAreaForm(emptyArea)
      setEditingArea(null)
    })
  }

  const savePlace = (e) => {
    e.preventDefault()
    const payload = {
      ...placeForm,
      service_area_id: Number(placeForm.service_area_id),
      zone_id: Number(placeForm.zone_id),
      aliases: placeForm.aliases.trim() || null,
      latitude: placeForm.latitude === '' ? null : Number(placeForm.latitude),
      longitude: placeForm.longitude === '' ? null : Number(placeForm.longitude),
      address_text: placeForm.address_text.trim() || null,
      notes: placeForm.notes.trim() || null,
    }
    runSave(async () => {
      await apiRequest(
        editingPlace
          ? `/api/v1/admin/locations/places/${editingPlace}`
          : '/api/v1/admin/locations/places',
        { method: editingPlace ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      setPlaceForm(emptyPlace)
      setEditingPlace(null)
    })
  }

  const saveFare = (e) => {
    e.preventDefault()
    if (fareForm.is_active && !canActivateSelectedFare) {
      setError(
        'To activate a route, select two different places whose places, service areas and zones are all active.',
      )
      return
    }
    if (fareForm.origin_place_id && fareForm.origin_place_id === fareForm.destination_place_id) {
      setError('Origin and destination must be different places.')
      return
    }
    const payload = {
      ...fareForm,
      origin_place_id: Number(fareForm.origin_place_id),
      destination_place_id: Number(fareForm.destination_place_id),
      base_amount: Number(fareForm.base_amount),
      vehicle_multiplier: Number(fareForm.vehicle_multiplier),
      extra_passenger_amount: Number(fareForm.extra_passenger_amount),
    }
    runSave(async () => {
      await apiRequest(
        editingFare
          ? `/api/v1/admin/locations/place-fares/${editingFare}`
          : '/api/v1/admin/locations/place-fares',
        { method: editingFare ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      setFareForm(emptyFare)
      setEditingFare(null)
    })
  }

  const editArea = (a) => {
    setEditingArea(a.id)
    setAreaForm({
      name: a.name || '', slug: a.slug || '',
      description: a.description || '', status: a.status || 'draft',
    })
  }

  const editPlace = (p) => {
    setEditingPlace(p.id)
    setPlaceForm({
      service_area_id: String(p.service_area_id ?? ''),
      zone_id: String(p.zone_id ?? ''),
      name: p.name || '', place_type: p.place_type || 'other',
      address_text: p.address_text || '',
      aliases: typeof p.aliases === 'string' ? p.aliases : (Array.isArray(p.aliases) ? p.aliases.join(', ') : ''),
      latitude: p.latitude ?? '', longitude: p.longitude ?? '',
      notes: p.notes || '', status: p.status || 'pending',
    })
    setTab('places')
  }

  const editFare = (f) => {
    setEditingFare(f.id)
    setFareForm({
      origin_place_id: String(f.origin_place_id),
      destination_place_id: String(f.destination_place_id),
      vehicle_type: f.vehicle_type || 'car',
      base_amount: String(f.base_amount ?? 0),
      vehicle_multiplier: String(f.vehicle_multiplier ?? 1),
      extra_passenger_amount: String(f.extra_passenger_amount ?? 0),
      is_active: Boolean(f.is_active),
    })
    setTab('fares')
  }

  const placeName = (id) =>
    places.find((p) => Number(p.id) === Number(id))?.name || `Place #${id}`

  const areaName = (id) =>
    areas.find((a) => Number(a.id) === Number(id))?.name || `Area #${id}`

  const placeIsPublicEligible = (place) => {
    if (!place || place.status !== 'active') return false

    const area = areas.find(
      (a) => Number(a.id) === Number(place.service_area_id),
    )
    const zone = zones.find(
      (z) => Number(z.id) === Number(place.zone_id),
    )

    return area?.status === 'active' && zone?.is_active === true
  }

  const selectedOrigin = places.find(
    (p) => Number(p.id) === Number(fareForm.origin_place_id),
  )

  const selectedDestination = places.find(
    (p) => Number(p.id) === Number(fareForm.destination_place_id),
  )

  const canActivateSelectedFare =
    Boolean(selectedOrigin) &&
    Boolean(selectedDestination) &&
    Number(selectedOrigin.id) !== Number(selectedDestination.id) &&
    placeIsPublicEligible(selectedOrigin) &&
    placeIsPublicEligible(selectedDestination)

  const input = (label, value, onChange, options = {}) => (
    <label className="admin-field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        required={options.required !== false} type={options.type || 'text'}
        min={options.min} step={options.step} placeholder={options.placeholder || ''} />
    </label>
  )

  return (
    <AppPage eyebrow="SUPER-ADMIN" title="Locations & pricing"
      description="Manage service areas, pickup and destination places, and exact-route fares."
      sectionTitle="Mobility configuration"
      sectionText="Changes apply through the protected EkiMove API. Verify each record before activating it.">
      <style>{`
        .admin-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
        .admin-tabs button,.admin-record button{padding:8px 12px;border:1px solid #ccd5e0;border-radius:8px;background:#fff;cursor:pointer}
        .admin-tabs button[aria-pressed=true]{background:#172554;color:#fff}
        .admin-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}
        .admin-field{display:flex;flex-direction:column;gap:6px;font-size:.9rem}
        .admin-field input,.admin-field select,.admin-field textarea{width:100%;padding:10px;border:1px solid #ccd5e0;border-radius:8px;box-sizing:border-box}
        .admin-field input[type=checkbox]{width:auto}
        .admin-submit{align-self:end;padding:11px 16px;border:0;border-radius:8px;background:#174ea6;color:white;cursor:pointer}
        .admin-record{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #e2e8f0}
        .admin-record small{display:block;color:#64748b;margin-top:4px}
        .admin-alert{padding:10px 12px;border-radius:8px;margin:12px 0;background:#f1f5f9}
        .admin-alert.error{background:#fee2e2;color:#991b1b}
      `}</style>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {notice && <div className="admin-alert" role="status">{notice}</div>}
      {loading ? <p>Loading configuration…</p> : (
        <>
          <div className="admin-tabs" aria-label="Configuration sections">
            <button aria-pressed={tab === 'areas'} onClick={() => setTab('areas')}>Service areas</button>
            <button aria-pressed={tab === 'places'} onClick={() => setTab('places')}>Locations & axes</button>
            <button aria-pressed={tab === 'fares'} onClick={() => setTab('fares')}>Route pricing</button>
            <button aria-pressed={tab === 'zones'} onClick={() => setTab('zones')}>Zones</button>
          </div>

          {tab === 'zones' && <>
            <h3>{editingZone ? `Edit zone #${editingZone}` : 'Create a zone'}</h3>
            <form className="admin-form" onSubmit={saveZone}>
              {input('Zone name', zoneForm.name, v => setZoneForm({ ...zoneForm, name: v }))}
              <label className="admin-field">
                <span>Status</span>
                <select
                  value={zoneForm.is_active ? 'active' : 'inactive'}
                  onChange={e => setZoneForm({ ...zoneForm, is_active: e.target.value === 'active' })}
                >
                  <option value="inactive">Inactive</option>
                  <option value="active">Active</option>
                </select>
              </label>
              <button className="admin-submit" disabled={busy}>
                {editingZone ? 'Save zone changes' : 'Create zone'}
              </button>
              {editingZone && (
                <button type="button" onClick={() => {
                  setEditingZone(null)
                  setZoneForm({ name: '', is_active: false })
                }}>
                  Cancel edit
                </button>
              )}
            </form>
            <h3>Existing zones ({zones.length})</h3>
            {zones.map(zone => (
              <div className="admin-record" key={zone.id}>
                <div>
                  <strong>{zone.name}</strong>
                  <small>#{zone.id} ? {zone.is_active ? 'Active' : 'Inactive'}</small>
                </div>
                <button type="button" onClick={() => editZone(zone)}>Edit</button>
              </div>
            ))}
          </>}

          {tab === 'areas' && <>
            <h3>{editingArea ? `Edit service area #${editingArea}` : 'Add a service area'}</h3>
            <form className="admin-form" onSubmit={saveArea}>
              {input('Area name', areaForm.name, v => setAreaForm({...areaForm,name:v}))}
              {input('Slug (optional)', areaForm.slug, v => setAreaForm({...areaForm,slug:v}), {required:false})}
              <label className="admin-field"><span>Status</span><select value={areaForm.status} onChange={e => setAreaForm({...areaForm,status:e.target.value})}><option value="draft">Draft</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label className="admin-field"><span>Description</span><input value={areaForm.description} onChange={e => setAreaForm({...areaForm,description:e.target.value})}/></label>
              <button className="admin-submit" disabled={busy}>{editingArea ? 'Save changes' : 'Create area'}</button>
              {editingArea && <button type="button" onClick={() => {setEditingArea(null);setAreaForm(emptyArea)}}>Cancel edit</button>}
            </form>
            <h3>Existing service areas ({areas.length})</h3>
            {areas.map(a => <div className="admin-record" key={a.id}><div><strong>{a.name}</strong><small>#{a.id} · {a.slug || 'No slug'} · {a.status}</small></div><button onClick={() => editArea(a)}>Edit</button></div>)}
          </>}

          {tab === 'places' && <>
            <h3>{editingPlace ? `Edit location #${editingPlace}` : 'Add a location or axis'}</h3>
            <form className="admin-form" onSubmit={savePlace}>
              <label className="admin-field"><span>Service area</span><select required value={placeForm.service_area_id} onChange={e => setPlaceForm({...placeForm,service_area_id:e.target.value})}><option value="">Select area</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}</select></label>
              <label className="admin-field"><span>Zone</span><select required value={placeForm.zone_id} onChange={e => setPlaceForm({...placeForm,zone_id:e.target.value})}><option value="">Select zone</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}{z.is_active ? '' : ' (inactive)'}</option>)}</select></label>
              {input('Location name', placeForm.name, v => setPlaceForm({...placeForm,name:v}))}
              <label className="admin-field"><span>Location type</span><select value={placeForm.place_type} onChange={e => setPlaceForm({...placeForm,place_type:e.target.value})}>{['street','landmark','junction','bus_stop','neighbourhood','other'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></label>
              {input('Address or axis description', placeForm.address_text, v => setPlaceForm({...placeForm,address_text:v}), {required:false})}
              {input('Aliases (comma-separated)', placeForm.aliases, v => setPlaceForm({...placeForm,aliases:v}), {required:false})}
              {input('Latitude (optional)', placeForm.latitude, v => setPlaceForm({...placeForm,latitude:v}), {required:false,type:'number',step:'any'})}
              {input('Longitude (optional)', placeForm.longitude, v => setPlaceForm({...placeForm,longitude:v}), {required:false,type:'number',step:'any'})}
              {input('Notes (optional)', placeForm.notes, v => setPlaceForm({...placeForm,notes:v}), {required:false})}
              <label className="admin-field"><span>Status</span><select value={placeForm.status} onChange={e => setPlaceForm({...placeForm,status:e.target.value})}><option value="pending">Pending</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <button className="admin-submit" disabled={busy || !areas.length || !zones.length}>{editingPlace ? 'Save location' : 'Create location'}</button>
              {editingPlace && <button type="button" onClick={() => {setEditingPlace(null);setPlaceForm(emptyPlace)}}>Cancel edit</button>}
            </form>
            <h3>Existing locations ({places.length})</h3>
            {places.map(p => <div className="admin-record" key={p.id}><div><strong>{p.name}</strong><small>#{p.id} · {areaName(p.service_area_id)} · {p.status} · Zone #{p.zone_id}</small></div><button onClick={() => editPlace(p)}>Edit</button></div>)}
          </>}

          {tab === 'fares' && <>
            <h3>{editingFare ? `Edit route fare #${editingFare}` : 'Configure an exact-route fare'}</h3>
            <form className="admin-form" onSubmit={saveFare}>
              <p className="admin-alert">
                Public booking requires an active service area, active pickup and
                destination places, active zones, and an active fare for the exact
                route and vehicle type. Changes become available through the public
                API once all these conditions are satisfied.
              </p>
              <label className="admin-field">
                <span>Origin / pickup</span>
                <select
                  required
                  value={fareForm.origin_place_id}
                  onChange={(e) => {
                    const originId = e.target.value
                    setError('')
                    setFareForm((current) => ({
                      ...current,
                      origin_place_id: originId,
                      destination_place_id:
                        current.destination_place_id === originId
                          ? ''
                          : current.destination_place_id,
                    }))
                  }}
                >
                  <option value="">Choose pickup</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Destination</span>
                <select
                  required
                  value={fareForm.destination_place_id}
                  onChange={(e) => {
                    setError('')
                    setFareForm({
                      ...fareForm,
                      destination_place_id: e.target.value,
                    })
                  }}
                >
                  <option value="">Choose destination</option>
                  {places
                    .filter(
                      (p) => String(p.id) !== fareForm.origin_place_id,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.status}
                      </option>
                    ))}
                </select>
              </label>
              <label className="admin-field"><span>Vehicle type</span><select value={fareForm.vehicle_type} onChange={e => setFareForm({...fareForm,vehicle_type:e.target.value})}>{['car','motorcycle','tricycle','van'].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
              {input('Base amount (NGN)',fareForm.base_amount,v=>setFareForm({...fareForm,base_amount:v}),{type:'number',min:'0',step:'0.01'})}
              {input('Vehicle multiplier',fareForm.vehicle_multiplier,v=>setFareForm({...fareForm,vehicle_multiplier:v}),{type:'number',min:'0.001',step:'0.001'})}
              {input('Extra passenger amount (NGN)',fareForm.extra_passenger_amount,v=>setFareForm({...fareForm,extra_passenger_amount:v}),{type:'number',min:'0',step:'0.01'})}
              <label className="admin-field">
                <span>Route status</span>
                <select
                  value={String(fareForm.is_active)}
                  onChange={(e) => {
                    const activate = e.target.value === 'true'

                    if (activate && !canActivateSelectedFare) {
                      setError(
                        'Activate the service area, both places and both zones before activating this fare.',
                      )
                      return
                    }

                    setError('')
                    setFareForm({
                      ...fareForm,
                      is_active: activate,
                    })
                  }}
                >
                  <option value="false">Inactive</option>
                  <option
                    value="true"
                    disabled={!canActivateSelectedFare && !fareForm.is_active}
                  >
                    Active — available for eligible bookings
                  </option>
                </select>
                <small>
                  {canActivateSelectedFare
                    ? 'Both places are eligible for a public route fare.'
                    : fareForm.is_active
                      ? 'This fare is currently marked active, but its route is ineligible. Deactivate it before saving, or restore eligibility before keeping it active.'
                      : 'Activate the required service area, places and zones before publishing this fare.'}
                </small>
              </label>
              <div className="admin-field"><span>Estimated fare for one passenger</span><strong>{money(Number(fareForm.base_amount || 0) * Number(fareForm.vehicle_multiplier || 0))}</strong><small>Backend formula: base amount × vehicle multiplier, plus extra-passenger charges where applicable.</small></div>
              <button className="admin-submit" disabled={busy || !places.length}>{editingFare ? 'Save fare changes' : 'Create route fare'}</button>
              {editingFare && <button type="button" onClick={() => {setEditingFare(null);setFareForm(emptyFare)}}>Cancel edit</button>}
            </form>
            <h3>Existing exact-route fares ({fares.length})</h3>
            {fares.map(f => <div className="admin-record" key={f.id}><div><strong>{placeName(f.origin_place_id)} → {placeName(f.destination_place_id)}</strong><small>#{f.id} · {f.vehicle_type} · Base {money(f.base_amount)} · Multiplier {f.vehicle_multiplier} · Extra passenger {money(f.extra_passenger_amount)} · {f.is_active ? 'Active' : 'Inactive'}</small></div><button onClick={() => editFare(f)}>Edit</button></div>)}
          </>}
        </>
      )}
    </AppPage>
  )
}
