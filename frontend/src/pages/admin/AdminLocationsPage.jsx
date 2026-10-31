import { useCallback, useEffect, useState } from 'react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { apiRequest } from '../../services/authService.js'
import BookingRulesCard from '../../components/admin/BookingRulesCard.jsx'

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

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) loadData()
    })
    return () => {
      cancelled = true
    }
  }, [loadData])

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
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={options.required !== false}
        type={options.type || 'text'}
        min={options.min}
        step={options.step}
        placeholder={options.placeholder || ''}
      />
    </label>
  )

  const select = (label, value, onChange, children, options = {}) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={options.required}
      >
        {children}
      </select>
      {options.hint && <span className="field-hint">{options.hint}</span>}
    </label>
  )

  const formActions = (editing, label, onCancel, disabled) => (
    <div className="row" style={{ gridColumn: '1 / -1' }}>
      <button type="submit" className="btn btn-primary" disabled={disabled}>
        {label}
      </button>
      {editing && (
        <button type="button" className="btn" onClick={onCancel}>
          Cancel edit
        </button>
      )}
    </div>
  )

  const recordList = (title, items, render) => (
    <section className="card" style={{ padding: 0 }}>
      <h3 className="section-title" style={{ padding: '18px 20px 6px' }}>
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="muted small" style={{ padding: '0 20px 18px' }}>Nothing here yet.</p>
      ) : (
        <div>{items.map(render)}</div>
      )}
    </section>
  )

  const TABS = [
    ['areas', 'Service areas'],
    ['places', 'Places'],
    ['fares', 'Route fares'],
    ['zones', 'Zones'],
  ]

  return (
    <AdminShell
      eyebrow="Configuration"
      title="Places & fares"
      description="Service areas, pickup and destination places, and the approved fare for each exact route."
    >
      <div className="stack">
        <BookingRulesCard />
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        {loading ? (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading configuration…
          </div>
        ) : (
          <>
            <div className="filter-pills" role="group" aria-label="Configuration sections">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="pill"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'zones' && (
              <div className="stack">
                <form className="card stack" onSubmit={saveZone}>
                  <h2 className="card-title">{editingZone ? `Edit zone #${editingZone}` : 'Create a zone'}</h2>
                  <div className="form-grid">
                    {input('Zone name', zoneForm.name, (v) => setZoneForm({ ...zoneForm, name: v }))}
                    {select(
                      'Status',
                      zoneForm.is_active ? 'active' : 'inactive',
                      (v) => setZoneForm({ ...zoneForm, is_active: v === 'active' }),
                      <>
                        <option value="inactive">Inactive</option>
                        <option value="active">Active</option>
                      </>,
                    )}
                    {formActions(
                      editingZone,
                      editingZone ? 'Save zone changes' : 'Create zone',
                      () => {
                        setEditingZone(null)
                        setZoneForm({ name: '', is_active: false })
                      },
                      busy,
                    )}
                  </div>
                </form>
                {recordList('Zones', zones, (zone) => (
                  <div className="record" key={zone.id}>
                    <div>
                      <p className="record-title">{zone.name}</p>
                      <p className="record-meta">Zone #{zone.id}</p>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={zone.is_active ? 'active' : 'inactive'} kind="area" />
                      <button type="button" className="btn btn-sm" onClick={() => editZone(zone)}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'areas' && (
              <div className="stack">
                <form className="card stack" onSubmit={saveArea}>
                  <h2 className="card-title">{editingArea ? `Edit service area #${editingArea}` : 'Add a service area'}</h2>
                  <div className="form-grid">
                    {input('Area name', areaForm.name, (v) => setAreaForm({ ...areaForm, name: v }))}
                    {input('Slug (optional)', areaForm.slug, (v) => setAreaForm({ ...areaForm, slug: v }), { required: false })}
                    {select(
                      'Status',
                      areaForm.status,
                      (v) => setAreaForm({ ...areaForm, status: v }),
                      <>
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </>,
                    )}
                    {input('Description (optional)', areaForm.description, (v) => setAreaForm({ ...areaForm, description: v }), { required: false })}
                    {formActions(
                      editingArea,
                      editingArea ? 'Save changes' : 'Create area',
                      () => {
                        setEditingArea(null)
                        setAreaForm(emptyArea)
                      },
                      busy,
                    )}
                  </div>
                </form>
                {recordList('Service areas', areas, (a) => (
                  <div className="record" key={a.id}>
                    <div>
                      <p className="record-title">{a.name}</p>
                      <p className="record-meta">#{a.id} · {a.slug || 'No slug'}</p>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={a.status} kind="area" />
                      <button type="button" className="btn btn-sm" onClick={() => editArea(a)}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'places' && (
              <div className="stack">
                <form className="card stack" onSubmit={savePlace}>
                  <h2 className="card-title">{editingPlace ? `Edit place #${editingPlace}` : 'Add a place'}</h2>
                  <div className="form-grid">
                    {select(
                      'Service area',
                      placeForm.service_area_id,
                      (v) => setPlaceForm({ ...placeForm, service_area_id: v }),
                      <>
                        <option value="">Select area</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}
                      </>,
                      { required: true },
                    )}
                    {select(
                      'Zone',
                      placeForm.zone_id,
                      (v) => setPlaceForm({ ...placeForm, zone_id: v }),
                      <>
                        <option value="">Select zone</option>
                        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.is_active ? '' : ' (inactive)'}</option>)}
                      </>,
                      { required: true },
                    )}
                    {input('Place name', placeForm.name, (v) => setPlaceForm({ ...placeForm, name: v }))}
                    {select(
                      'Place type',
                      placeForm.place_type,
                      (v) => setPlaceForm({ ...placeForm, place_type: v }),
                      ['street', 'landmark', 'junction', 'bus_stop', 'neighbourhood', 'other'].map((v) => (
                        <option key={v} value={v}>{v.replace('_', ' ')}</option>
                      )),
                    )}
                    {input('Address or directions (optional)', placeForm.address_text, (v) => setPlaceForm({ ...placeForm, address_text: v }), { required: false })}
                    {input('Other names (comma-separated)', placeForm.aliases, (v) => setPlaceForm({ ...placeForm, aliases: v }), { required: false })}
                    {input('Latitude (optional)', placeForm.latitude, (v) => setPlaceForm({ ...placeForm, latitude: v }), { required: false, type: 'number', step: 'any' })}
                    {input('Longitude (optional)', placeForm.longitude, (v) => setPlaceForm({ ...placeForm, longitude: v }), { required: false, type: 'number', step: 'any' })}
                    {input('Notes (optional)', placeForm.notes, (v) => setPlaceForm({ ...placeForm, notes: v }), { required: false })}
                    {select(
                      'Status',
                      placeForm.status,
                      (v) => setPlaceForm({ ...placeForm, status: v }),
                      <>
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </>,
                    )}
                    {formActions(
                      editingPlace,
                      editingPlace ? 'Save place' : 'Create place',
                      () => {
                        setEditingPlace(null)
                        setPlaceForm(emptyPlace)
                      },
                      busy || !areas.length || !zones.length,
                    )}
                  </div>
                </form>
                {recordList('Places', places, (p) => (
                  <div className="record" key={p.id}>
                    <div>
                      <p className="record-title">{p.name}</p>
                      <p className="record-meta">#{p.id} · {areaName(p.service_area_id)} · Zone #{p.zone_id}</p>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={p.status} kind="area" />
                      <button type="button" className="btn btn-sm" onClick={() => editPlace(p)}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'fares' && (
              <div className="stack">
                <form className="card stack" onSubmit={saveFare}>
                  <h2 className="card-title">{editingFare ? `Edit route fare #${editingFare}` : 'Set a route fare'}</h2>
                  <Alert tone="info">
                    Passengers can only book a route when its service area, both
                    places, both zones and this fare are all active.
                  </Alert>
                  <div className="form-grid">
                    {select(
                      'Pickup',
                      fareForm.origin_place_id,
                      (originId) => {
                        setError('')
                        setFareForm((current) => ({
                          ...current,
                          origin_place_id: originId,
                          destination_place_id:
                            current.destination_place_id === originId
                              ? ''
                              : current.destination_place_id,
                        }))
                      },
                      <>
                        <option value="">Choose pickup</option>
                        {places.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} · {p.status}</option>
                        ))}
                      </>,
                      { required: true },
                    )}
                    {select(
                      'Destination',
                      fareForm.destination_place_id,
                      (value) => {
                        setError('')
                        setFareForm({ ...fareForm, destination_place_id: value })
                      },
                      <>
                        <option value="">Choose destination</option>
                        {places
                          .filter((p) => String(p.id) !== fareForm.origin_place_id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.name} · {p.status}</option>
                          ))}
                      </>,
                      { required: true },
                    )}
                    {select(
                      'Vehicle type',
                      fareForm.vehicle_type,
                      (v) => setFareForm({ ...fareForm, vehicle_type: v }),
                      ['car', 'motorcycle', 'tricycle', 'van'].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      )),
                    )}
                    {input('Base amount (₦)', fareForm.base_amount, (v) => setFareForm({ ...fareForm, base_amount: v }), { type: 'number', min: '0', step: '0.01' })}
                    {input('Vehicle multiplier', fareForm.vehicle_multiplier, (v) => setFareForm({ ...fareForm, vehicle_multiplier: v }), { type: 'number', min: '0.001', step: '0.001' })}
                    {input('Each extra passenger (₦)', fareForm.extra_passenger_amount, (v) => setFareForm({ ...fareForm, extra_passenger_amount: v }), { type: 'number', min: '0', step: '0.01' })}
                    <label className="field">
                      <span className="field-label">Route status</span>
                      <select
                        className="select"
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
                          Active: open for bookings
                        </option>
                      </select>
                      <span className="field-hint">
                        {canActivateSelectedFare
                          ? 'Both places are eligible for a public route fare.'
                          : fareForm.is_active
                            ? 'This fare is marked active but its route is ineligible. Deactivate it before saving, or restore eligibility first.'
                            : 'Activate the service area, places and zones before publishing this fare.'}
                      </span>
                    </label>
                    <div className="field">
                      <span className="field-label">Fare for one passenger</span>
                      <span className="money" style={{ fontSize: 26, color: 'var(--green-800)' }}>
                        {money(Number(fareForm.base_amount || 0) * Number(fareForm.vehicle_multiplier || 0))}
                      </span>
                      <span className="field-hint">Base × multiplier, plus the extra-passenger charge for each additional rider.</span>
                    </div>
                    {formActions(
                      editingFare,
                      editingFare ? 'Save fare changes' : 'Create route fare',
                      () => {
                        setEditingFare(null)
                        setFareForm(emptyFare)
                      },
                      busy || !places.length,
                    )}
                  </div>
                </form>
                {recordList('Route fares', fares, (f) => (
                  <div className="record" key={f.id}>
                    <div>
                      <p className="record-title">{placeName(f.origin_place_id)} → {placeName(f.destination_place_id)}</p>
                      <p className="record-meta">
                        #{f.id} · {f.vehicle_type} · Base {money(f.base_amount)} · ×{f.vehicle_multiplier} · Extra passenger {money(f.extra_passenger_amount)}
                      </p>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={f.is_active ? 'active' : 'inactive'} kind="area" />
                      <button type="button" className="btn btn-sm" onClick={() => editFare(f)}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  )
}
