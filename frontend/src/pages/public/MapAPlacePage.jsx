import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Crosshair, MapPin, Search } from 'lucide-react'
import PublicPage from '../../components/site/PublicPage.jsx'
import Alert from '../../components/ui/Alert.jsx'
import useGpsReading from '../../hooks/useGpsReading.js'
import { apiUrl } from '../../services/authService.js'
import { nigerianMobile, phoneTyping } from '../../utils/inputRules.js'

const PHONE_KEY = 'ekimove.surveyPhone'

function savedPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) || ''
  } catch {
    return ''
  }
}

async function post(path, body) {
  const response = await fetch(apiUrl(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  return data
}

/**
 * Public "Map a place" survey: anyone standing at a place in Ado-Ekiti or
 * Iworoko sends its exact location from their phone. EkiMove's team checks
 * every answer before it changes a pin.
 */
export default function MapAPlacePage() {
  const gps = useGpsReading()
  const [places, setPlaces] = useState([])
  const [maxAccuracy, setMaxAccuracy] = useState(50)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(null) // a listed place, or { new: true }
  const [newName, setNewName] = useState('')
  const [phone, setPhone] = useState(savedPhone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    document.title = 'Map a place · EkiMove'
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/v1/survey/places'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPlaces(data.places || [])
          setMaxAccuracy(data.max_accuracy_m || 50)
        }
      })
      .catch(() => {})
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? places.filter((p) => p.name.toLowerCase().includes(q) || p.zone.toLowerCase().includes(q)) : places
    return list.slice(0, q ? 30 : 12)
  }, [places, query])

  const r = gps.reading
  const goodFix = r && r.accuracy_m <= maxAccuracy
  const ready = goodFix && (chosen?.id || (chosen?.new && newName.trim().length >= 3))

  async function send(event) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      const contact = phone.trim() ? nigerianMobile(phone) : null
      const result = await post('/api/v1/survey/reports', {
        place_id: chosen.id || null,
        name: chosen.new ? newName.trim() : null,
        latitude: r.latitude, longitude: r.longitude, accuracy_m: r.accuracy_m,
        contact_phone: contact, website: event.currentTarget.elements.website?.value || null,
      })
      try {
        if (phone.trim()) localStorage.setItem(PHONE_KEY, phone.trim())
      } catch {
        /* fine */
      }
      setDone(result.message)
      setCount((c) => c + 1)
      if (chosen.id) setPlaces((list) => list.map((p) => (p.id === chosen.id ? { ...p, needed: false, sent: true } : p)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function another() {
    setDone(null)
    setChosen(null)
    setNewName('')
    setQuery('')
    gps.reset()
  }

  return (
    <PublicPage eyebrow="Help map Ado-Ekiti" heading="Map a place for EkiMove"
      intro="Standing at a junction, school, market, church or shop in Ado-Ekiti or Iworoko? Send its exact location in 30 seconds. It helps EkiMove show the right fare for everyone.">
      <div className="survey stack">
        {done ? (
          <section className="card stack survey-done" aria-live="polite">
            <CheckCircle2 size={36} aria-hidden="true" />
            <h2 className="card-title">{done}</h2>
            <p className="muted">
              Our team checks every answer before it’s used. {count > 1 ? `You’ve sent ${count} places on this visit. ` : ''}
              {phone ? 'We’ll contact you on the number you gave if you win a reward.' : ''}
            </p>
            <button type="button" className="btn btn-primary btn-lg" onClick={another}>
              <MapPin size={18} aria-hidden="true" /> Map another place
            </button>
          </section>
        ) : (
          <form className="stack" onSubmit={send}>
            <section className="card stack stack-sm">
              <h2 className="card-title survey-step"><span>1</span> Stand at the place</h2>
              <p className="muted small">At the gate, junction or sign people know. Outdoors works best.</p>
              {gps.status === 'idle' ? (
                <button type="button" className="btn btn-primary" onClick={gps.start}>
                  <Crosshair size={18} aria-hidden="true" /> Use my location
                </button>
              ) : gps.status === 'error' ? (
                <>
                  <Alert tone="error">{gps.error}</Alert>
                  <button type="button" className="btn" onClick={gps.start}>Try again</button>
                </>
              ) : (
                <p className={`gps-readout ${goodFix ? 'is-ok' : ''}`} role="status">
                  <Crosshair size={16} aria-hidden="true" />
                  {!r ? 'Finding your location…'
                    : gps.status === 'locating' ? `Accurate to ±${r.accuracy_m} m, still improving…`
                      : goodFix ? `Got it, accurate to ±${r.accuracy_m} m.`
                        : `Only accurate to ±${r.accuracy_m} m. Step outside and tap “Try again”.`}
                  {gps.status === 'done' && !goodFix && <button type="button" className="btn btn-sm" onClick={gps.start}>Try again</button>}
                </p>
              )}
            </section>

            <section className="card stack stack-sm">
              <h2 className="card-title survey-step"><span>2</span> Which place is this?</h2>
              {chosen ? (
                <div className="survey-chosen">
                  <MapPin size={18} aria-hidden="true" />
                  <strong>{chosen.new ? 'A place that’s not on the list' : chosen.name}</strong>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => setChosen(null)}>Change</button>
                </div>
              ) : (
                <>
                  <div className="search-box">
                    <Search size={16} aria-hidden="true" />
                    <input id="survey-search" className="input" type="search" aria-label="Search places"
                      placeholder="Search, e.g. Fajuyi, EKSU gate" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  <ul className="survey-list" aria-label="Places">
                    {matches.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => setChosen(p)} disabled={p.sent}>
                          <span>{p.name}<small>{p.zone}</small></span>
                          {p.sent ? <em className="is-sent">Sent</em> : p.needed ? <em>Needed</em> : null}
                        </button>
                      </li>
                    ))}
                    <li>
                      <button type="button" className="survey-new" onClick={() => setChosen({ new: true })}>
                        <span>It’s not on the list<small>Type its name next</small></span>
                      </button>
                    </li>
                  </ul>
                </>
              )}
              {chosen?.new && (
                <label className="field" htmlFor="survey-name">
                  <span className="field-label">What do people call this place?</span>
                  <input id="survey-name" className="input" maxLength={120} value={newName} autoFocus
                    placeholder="e.g. Ola Filling Station, Basiri" onChange={(e) => setNewName(e.target.value)} />
                  <span className="field-hint">Public places only, like shops, schools, junctions or churches. Never a private home.</span>
                </label>
              )}
            </section>

            <section className="card stack stack-sm">
              <h2 className="card-title survey-step"><span>3</span> Your phone number (optional)</h2>
              <label className="field" htmlFor="survey-phone">
                <span className="field-label">For rewards and thank-yous</span>
                <input id="survey-phone" className="input" type="tel" inputMode="tel" maxLength={18}
                  placeholder="e.g. 0803 123 4567" value={phone}
                  onChange={(e) => setPhone(phoneTyping(e.target.value))} />
                <span className="field-hint">We only use it to contact you about rewards for helping. You can leave it empty.</span>
              </label>
              {/* Left empty by people; automated spam fills it in. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="survey-trap" aria-hidden="true" />
            </section>

            <Alert tone="error">{error}</Alert>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!ready || busy}>
              {busy ? 'Sending…' : 'Send this place'}
            </button>
            {!ready && (
              <p className="muted small" style={{ textAlign: 'center' }}>
                {!goodFix ? 'First, tap “Use my location” while standing at the place.' : 'Now choose the place from the list.'}
              </p>
            )}
          </form>
        )}
      </div>
    </PublicPage>
  )
}
