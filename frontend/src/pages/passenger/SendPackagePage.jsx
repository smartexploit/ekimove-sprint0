import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Package } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PlacePicker from '../../components/booking/PlacePicker.jsx'
import DropPinSheet from '../../components/booking/DropPinSheet.jsx'
import { bookingStops, pinValue } from '../../utils/stops.js'
import { apiRequest } from '../../services/authService.js'
import Select from '../../components/ui/Select.jsx'
import WhenPicker from '../../components/booking/WhenPicker.jsx'
import PromoField from '../../components/booking/PromoField.jsx'
import { SavedPlacesBar } from '../../components/booking/SavedPlaces.jsx'
import useTripOptions from '../../hooks/useTripOptions.js'
import useBookingRules from '../../hooks/useBookingRules.js'
import { createDelivery, getDeliveryOptions } from '../../services/deliveryService.js'
import { getMyPromos, listSavedPlaces } from '../../services/promoService.js'
import { formatNaira } from '../../utils/format.js'
import { formatPickupTime, toApiTime } from '../../utils/schedule.js'
import { nameProblem, nameTyping, nigerianMobile, phoneTyping } from '../../utils/inputRules.js'

const EMPTY = {
  service_area_id: '', origin_place_id: '', destination_place_id: '', size: '', description: '', fragile: false,
  recipient_name: '', recipient_phone: '', notes: '', allowed: false,
}

export default function SendPackagePage() {
  const [form, setForm] = useState(EMPTY)
  const [quote, setQuote] = useState({ key: '', enabled: true, options: [] })
  const [pickupTime, setPickupTime] = useState(null)
  const [promo, setPromo] = useState(null)
  const [saved, setSaved] = useState([])
  const [giftCodes, setGiftCodes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [dropping, setDropping] = useState(null)
  const [pinsEnabled, setPinsEnabled] = useState(false)
  const rules = useBookingRules()
  const trip = useTripOptions({
    areaId: form.service_area_id, originId: form.origin_place_id, destinationId: form.destination_place_id,
    passengerCount: '1',
  })
  const { areas, places, loadingAreas, loadingPlaces } = trip
  const routeKey = trip.routeSelected ? `${form.origin_place_id}|${form.destination_place_id}` : ''

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/points/settings').then((d) => active && setPinsEnabled(Boolean(d?.enabled))).catch(() => {})
    Promise.resolve().then(() => listSavedPlaces()).then((list) => active && Array.isArray(list) && setSaved(list)).catch(() => {})
    Promise.resolve().then(() => getMyPromos()).then((d) => active && Array.isArray(d?.codes) && setGiftCodes(d.codes)).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!routeKey) return undefined
    let active = true
    Promise.resolve().then(() => getDeliveryOptions(form.origin_place_id, form.destination_place_id))
      .then((result) => active && setQuote({ key: routeKey, enabled: result.enabled, options: result.options || [] }))
      .catch(() => active && setQuote({ key: routeKey, enabled: true, options: [] }))
    return () => {
      active = false
    }
  }, [routeKey, form.origin_place_id, form.destination_place_id])

  const options = quote.key === routeKey ? quote.options : []
  const chosen = options.find((option) => option.size === form.size)
  const discount = promo && chosen ? Number(promo.discount) : 0
  const toPay = chosen ? Number(chosen.price) - discount : null

  function set(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value }
      if (name === 'service_area_id') Object.assign(next, { origin_place_id: '', destination_place_id: '', size: '' })
      return next
    })
    setError('')
  }
  const field = (name) => (event) => set(name, event.target.type === 'checkbox' ? event.target.checked : event.target.value)

  async function submit(event) {
    event.preventDefault()
    if (!chosen) return setError('Choose the pickup, drop-off and package size.')
    if (!form.allowed) return setError('Please confirm the package holds no banned items.')
    const problem = nameProblem(form.recipient_name, "recipient's name") ||
      (nigerianMobile(form.recipient_phone) ? '' : "Enter the recipient's Nigerian mobile number, like 0803 123 4567.")
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      setDone(await createDelivery({
        ...bookingStops(form.origin_place_id, form.destination_place_id),
        size: form.size,
        description: form.description.trim(),
        recipient_name: form.recipient_name.trim().replace(/\s+/g, ' '),
        recipient_phone: nigerianMobile(form.recipient_phone),
        notes: form.notes.trim() || null,
        fragile: form.fragile,
        no_prohibited_items: true,
        ...(pickupTime ? { scheduled_for: toApiTime(pickupTime) } : {}),
        ...(promo ? { promo_code: promo.code } : {}),
      }))
    } catch (err) {
      setError(err.message || 'Could not book the delivery.')
    } finally {
      setBusy(false)
    }
    return undefined
  }

  if (done) {
    return (
      <AppShell title={done.scheduled_for ? 'Delivery booked' : 'Finding a rider'}
        description={done.scheduled_for ? `Pickup ${formatPickupTime(done.scheduled_for)}.` : 'We’re offering it to a nearby verified rider.'}>
        <section className="card card-lg stack" style={{ maxWidth: 640 }} aria-live="polite">
          <div className="row" style={{ gap: 10 }}>
            <CheckCircle2 size={28} color="#2E8B63" aria-hidden="true" />
            <h2 className="card-title">Delivery #{done.id}</h2>
          </div>
          <dl className="kv">
            <div><dt>From</dt><dd>{done.origin_text}</dd></div>
            <div><dt>To</dt><dd>{done.destination_text}</dd></div>
            <div><dt>Recipient</dt><dd>{done.recipient_name}</dd></div>
            <div><dt>You pay</dt><dd>{formatNaira(done.amount_to_pay)}</dd></div>
          </dl>
          <Alert tone="info">
            Once a rider is assigned, pay in My rides. You’ll get a 4-digit delivery code there: the rider only finishes
            when {done.recipient_name} gives it to them.
          </Alert>
          <div className="row">
            <Link className="btn btn-primary" to="/my-rides">Follow this delivery</Link>
            <Link className="btn" to="/dashboard">Back to home</Link>
          </div>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell className="has-bottom-bar" title="Send a package"
      description="A verified rider collects it and hands it over only with the recipient’s code.">
      {loadingAreas ? (
        <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> Loading…</div>
      ) : (
        <form className="passenger-booking-form two-col" onSubmit={submit}>
          <div className="stack">
            <Alert tone="error">{error || trip.areasError || trip.placesError}</Alert>
            {!quote.enabled && <Alert tone="warning">Deliveries are paused right now. Please check back soon.</Alert>}
            {areas.length > 1 && (
              <label className="field">
                <span className="field-label">Service area</span>
                <Select value={form.service_area_id} onChange={field('service_area_id')} required>
                  <option value="">Choose service area</option>
                  {areas.map((area) => <option key={area.id} value={String(area.id)}>{area.name}</option>)}
                </Select>
              </label>
            )}
            <div className="card route">
              <div className="route-rail" aria-hidden="true">
                <span className="route-dot" /><span className="route-line" /><span className="route-end" />
              </div>
              <PlacePicker label="Pickup" name="origin_place_id" value={form.origin_place_id} places={places}
                onChange={(id) => set('origin_place_id', id)} disabled={!trip.effectiveAreaId || loadingPlaces}
                loading={loadingPlaces} placeholder="Where the rider collects it" required
                onDropPin={pinsEnabled ? (current) => setDropping({ field: 'origin_place_id', current }) : null} />
              <PlacePicker label="Drop-off" name="destination_place_id" value={form.destination_place_id} places={places}
                onChange={(id) => set('destination_place_id', id)} disabled={!trip.effectiveAreaId || loadingPlaces}
                loading={loadingPlaces} placeholder="Where it goes" required
                onDropPin={pinsEnabled ? (current) => setDropping({ field: 'destination_place_id', current }) : null} />
            </div>
            <SavedPlacesBar saved={saved} places={places} originId={form.origin_place_id}
              destinationId={form.destination_place_id} onPick={(name, id) => set(name, id)}
              onSaved={(item) => setSaved((list) => [...list.filter((x) => x.id !== item.id), item])} />

            <section className="card stack stack-sm" aria-labelledby="recipient-title">
              <h2 id="recipient-title" className="section-title">Who receives it</h2>
              <label className="field">
                <span className="field-label">Recipient’s name</span>
                <input className="input" required minLength={2} maxLength={80} autoComplete="off"
                  value={form.recipient_name} onChange={(event) => set('recipient_name', nameTyping(event.target.value))} />
              </label>
              <label className="field">
                <span className="field-label">Recipient’s phone</span>
                <input className="input" type="tel" inputMode="tel" required minLength={10} maxLength={18} autoComplete="off"
                  placeholder="e.g. 0803 123 4567" value={form.recipient_phone}
                  onChange={(event) => set('recipient_phone', phoneTyping(event.target.value))} />
                <span className="field-hint">The rider may call them. They get the delivery code to give the rider.</span>
              </label>
              <label className="field">
                <span className="field-label">Directions for the rider (optional)</span>
                <input className="input" maxLength={500} placeholder="e.g. Blue gate opposite the pharmacy"
                  value={form.notes} onChange={field('notes')} />
              </label>
            </section>
            <WhenPicker value={pickupTime} onChange={setPickupTime} leadMinutes={rules.schedule_lead_minutes || 20} />
          </div>

          <div className="stack">
            <fieldset className="choice-list" disabled={!trip.routeSelected}>
              <legend className="choice-legend">Package size</legend>
              {!trip.routeSelected && <p className="card muted small">Pick the pickup and drop-off to see prices.</p>}
              {trip.routeSelected && quote.key === routeKey && options.length === 0 && quote.enabled && (
                <p className="card muted small" role="status">Deliveries aren’t priced for this route yet.</p>
              )}
              {options.map((option) => (
                <label className="choice" key={option.size}>
                  <input type="radio" name="size" value={option.size} checked={form.size === option.size}
                    onChange={field('size')} />
                  <span className={`choice-icon ${option.size === 'large' ? 'choice-icon-warm' : ''}`}>
                    <Package size={22} aria-hidden="true" />
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">{option.label}</span>
                    <span className="choice-sub">
                      {option.hint}{option.distance_km != null && ` · about ${option.distance_km} km`}
                    </span>
                  </span>
                  <span className="choice-price">{formatNaira(option.price, { decimals: 0 })}</span>
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="field-label">What’s inside</span>
              <input className="input" required minLength={3} maxLength={300} placeholder="e.g. Documents in an envelope"
                value={form.description} onChange={field('description')} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.fragile} onChange={field('fragile')} />
              Fragile: handle with care
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.allowed} onChange={field('allowed')} />
              <span>
                It holds no cash, weapons, drugs, stolen, dangerous or banned items (
                <Link className="text-link" to="/policies/community" target="_blank" rel="noreferrer">see the list</Link>).
              </span>
            </label>
            <PromoField fare={chosen ? chosen.price : null} applied={promo} onChange={setPromo} suggestions={giftCodes} />
            <div className="bottom-bar">
              <div className="fare-total">
                <span className="muted small" style={{ fontWeight: 700 }}>Delivery price</span>
                {discount > 0 && <span className="fare-was">{formatNaira(chosen.price)}</span>}
                <span className="money">{toPay !== null ? formatNaira(toPay) : '—'}</span>
              </div>
              <button className="btn btn-accent btn-lg" type="submit" disabled={busy || !chosen || !quote.enabled}>
                {busy ? 'Sending…' : pickupTime ? 'Book delivery' : 'Send package'}
              </button>
            </div>
          </div>
        </form>
      )}
      {dropping && (
        <DropPinSheet
          title={dropping.field === 'origin_place_id' ? 'Drop the pickup pin' : 'Drop the drop-off pin'}
          question={dropping.field === 'origin_place_id' ? 'How will the rider find the package?' : 'How will the rider find the recipient?'}
          initial={dropping.current} allowHere={dropping.field === 'origin_place_id'}
          onCancel={() => setDropping(null)}
          onDone={(point) => {
            set(dropping.field, pinValue(point))
            set('size', '')
            setDropping(null)
          }} />
      )}
    </AppShell>
  )
}
