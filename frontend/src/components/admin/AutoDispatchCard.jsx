import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import { getAdminSettings, saveAdminSettings } from '../../services/accountService.js'

/** Super-admin switch and timings for automatic driver offers. */
export default function AutoDispatchCard({ readOnly = false }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getAdminSettings()
      .then((data) => active && setForm({
        enabled: data.auto_dispatch_enabled,
        seconds: String(data.dispatch_offer_seconds),
        offers: String(data.dispatch_max_offers),
        mode: data.dispatch_mode || 'all',
      }))
      .catch((err) => active && setError(err.message || 'Could not load dispatch settings.'))
    return () => {
      active = false
    }
  }, [])

  async function save(event) {
    event.preventDefault()
    const seconds = Number(form.seconds)
    const offers = Number(form.offers)
    if (!(seconds >= 15 && seconds <= 120)) return setError('Time to accept must be 15 to 120 seconds.')
    if (!(offers >= 1 && offers <= 20)) return setError('Rounds must be 1 to 20.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveAdminSettings({
        auto_dispatch_enabled: form.enabled,
        dispatch_offer_seconds: seconds,
        dispatch_max_offers: offers,
        dispatch_mode: form.mode,
      })
      setNotice('Saved.')
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack stack-sm" onSubmit={save} aria-labelledby="auto-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <span className="instant-icon" aria-hidden="true"><Zap size={20} /></span>
        <div>
          <h2 id="auto-title" className="section-title">Automatic assignment</h2>
          <p className="muted small">
            {form?.mode === 'one'
              ? 'Each request is offered to the nearest free driver. If they decline or don’t answer, the next driver is asked. After the last try it waits here for you.'
              : 'Each request pops up for every free, online driver with the right vehicle at once (okada bookings to okada drivers, car bookings to car drivers). The first to accept gets it. Drivers on a trip aren’t disturbed. If no one accepts after the last round, it waits here for you.'}
          </p>
        </div>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {form && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={form.enabled} disabled={readOnly}
              onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))} />
            Offer requests to drivers automatically
          </label>
          <fieldset className="chip-row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>Who gets each request</legend>
            {[['all', 'All free drivers at once (fastest)'], ['one', 'One driver at a time']].map(([value, label]) => (
              <label key={value} className={`chip ${form.mode === value ? 'is-active' : ''}`}>
                <input type="radio" className="sr-only" name="dispatch-mode" value={value} checked={form.mode === value}
                  disabled={!form.enabled || readOnly} onChange={() => setForm((f) => ({ ...f, mode: value }))} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field-label">Seconds to accept</span>
              <input className="input" inputMode="numeric" value={form.seconds} disabled={!form.enabled || readOnly}
                onChange={(event) => setForm((f) => ({ ...f, seconds: event.target.value.replace(/\D/g, '') }))} />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span className="field-label">{form.mode === 'one' ? 'Drivers to try' : 'Rounds before it comes to you'}</span>
              <input className="input" inputMode="numeric" value={form.offers} disabled={!form.enabled || readOnly}
                onChange={(event) => setForm((f) => ({ ...f, offers: event.target.value.replace(/\D/g, '') }))} />
            </label>
            {readOnly
              ? <p className="muted small">Only a super-admin can change these.</p>
              : <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
          </div>
        </>
      )}
    </form>
  )
}
