import { useCallback, useEffect, useState } from 'react'
import Alert from '../ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

/**
 * Transfers that reached a passenger account but could not be matched to a
 * ride automatically (wrong amount, no unpaid ride, unknown account).
 */
export default function DepositsPanel() {
  const [items, setItems] = useState({ loaded: false, list: [] })
  const [forms, setForms] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiRequest('/api/v1/admin/deposits?status=unmatched')
      setItems({ loaded: true, list: Array.isArray(data) ? data : [] })
    } catch (err) {
      setItems({ loaded: true, list: [] })
      setError(err.message || 'Could not load deposits.')
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) load()
    })
    return () => {
      active = false
    }
  }, [load])

  const update = (id, patch) =>
    setForms((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }))

  async function act(deposit, action) {
    const form = forms[deposit.id] || {}
    const reason = (form.reason || '').trim()
    if (reason.length < 3) {
      setError('Add a note of at least 3 characters first.')
      return
    }
    const body =
      action === 'match'
        ? { ride_id: Number(form.rideId), reason }
        : { reason }
    if (action === 'match' && !(body.ride_id > 0)) {
      setError('Enter the ride number this deposit pays for.')
      return
    }
    setBusyId(deposit.id)
    setError('')
    setNotice('')
    try {
      await apiRequest(`/api/v1/admin/deposits/${deposit.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setNotice(action === 'match' ? `Deposit matched to ride #${body.ride_id}.` : 'Deposit closed.')
      await load()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="stack" aria-labelledby="deposits-title">
      <div>
        <h2 id="deposits-title" className="section-title">Deposits to check</h2>
        <p className="muted small">
          Money that arrived in a passenger account but didn't match an unpaid ride automatically.
        </p>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {items.loaded && items.list.length === 0 ? (
        <p className="card muted small">Every deposit has been matched. Nothing to check.</p>
      ) : (
        <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
          {items.list.map((deposit) => (
            <article className="card stack" key={deposit.id}>
              <p className="money" style={{ fontSize: 24, color: 'var(--green-800)' }}>
                {formatNaira(deposit.amount)}
              </p>
              <dl className="rows small">
                <div><dt>Passenger</dt><dd>{deposit.passenger ? `${deposit.passenger.name} · ${deposit.passenger.phone}` : 'Unknown account'}</dd></div>
                <div><dt>Sender</dt><dd>{deposit.sender_name || '—'}</dd></div>
                <div><dt>Reference</dt><dd style={{ wordBreak: 'break-all' }}>{deposit.reference}</dd></div>
                <div><dt>Received</dt><dd>{deposit.created_at ? formatDateTime(deposit.created_at) : '—'}</dd></div>
              </dl>
              {deposit.note && <p className="muted small">{deposit.note}</p>}
              <label className="field">
                <span className="field-label">Ride number (to match)</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={forms[deposit.id]?.rideId || ''}
                  onChange={(event) => update(deposit.id, { rideId: event.target.value.replace(/\D/g, '') })}
                  placeholder="e.g. 502"
                />
              </label>
              <label className="field">
                <span className="field-label">Note</span>
                <input
                  className="input"
                  value={forms[deposit.id]?.reason || ''}
                  onChange={(event) => update(deposit.id, { reason: event.target.value })}
                  placeholder="What you checked, or how it was refunded"
                />
              </label>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" disabled={busyId !== null}
                  onClick={() => act(deposit, 'match')}>
                  Match to ride
                </button>
                <button type="button" className="btn btn-sm" disabled={busyId !== null}
                  onClick={() => act(deposit, 'resolve')}>
                  Refunded / not a fare
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
