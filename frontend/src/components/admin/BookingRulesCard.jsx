import { useEffect, useState } from 'react'
import { Motorbike } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import { getAdminSettings, saveAdminSettings } from '../../services/accountService.js'

/** Super-admin control for the motorcycle second-passenger rule. */
export default function BookingRulesCard() {
  const [rules, setRules] = useState(null)
  const [enabled, setEnabled] = useState(true)
  const [fee, setFee] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    getAdminSettings()
      .then((data) => {
        if (!active) return
        setRules(data)
        setEnabled(data.motorcycle_second_passenger_enabled)
        setFee(String(data.motorcycle_second_passenger_fee))
      })
      .catch((err) => active && setError(err.message || 'Could not load booking rules.'))
    return () => {
      active = false
    }
  }, [])

  async function save(event) {
    event.preventDefault()
    const amount = Number(fee)
    if (!Number.isInteger(amount) || amount < 0) return setError('Enter the extra charge in whole naira.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await saveAdminSettings({
        motorcycle_second_passenger_enabled: enabled,
        motorcycle_second_passenger_fee: amount,
      })
      setRules(data)
      setNotice('Saved. New bookings use these rules straight away.')
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={save} aria-labelledby="rules-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true"><Motorbike size={20} /></span>
        <div>
          <h2 id="rules-title" className="section-title">Booking rules</h2>
          <p className="muted small">Cars carry up to 4 passengers. A motorcycle carries 1.</p>
        </div>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {rules && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Allow a second passenger on motorcycles
          </label>
          <label className="field">
            <span className="field-label">Extra charge for the second passenger (₦)</span>
            <input className="input" inputMode="numeric" value={fee} disabled={!enabled}
              onChange={(event) => setFee(event.target.value.replace(/[^\d]/g, ''))} />
            <span className="field-hint">
              Used on every motorcycle route, unless that route's own “extra passenger” amount is set
              above ₦0, which then applies instead.
            </span>
          </label>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save booking rules'}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
