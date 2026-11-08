import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, Phone, Users } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const STATE = { free: ['Free', 'badge-green'], on_trip: ['On a trip', 'badge-gold'], offline: ['Offline', ''] }
const telLink = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`

/** Every approved driver: who's free, on a trip or offline, with Call and Message. */
export default function DriverRoster() {
  const [drivers, setDrivers] = useState(null)
  const [filter, setFilter] = useState('active')
  const [composing, setComposing] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)

  const load = useCallback(() => apiRequest('/api/v1/admin/dispatch/drivers')
    .then(setDrivers).catch((err) => setError(err.message || 'Could not load drivers.')), [])

  useEffect(() => {
    let active = true
    const run = () => apiRequest('/api/v1/admin/dispatch/drivers')
      .then((list) => active && setDrivers(list))
      .catch((err) => active && setError(err.message || 'Could not load drivers.'))
    run()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && run(), 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  async function send(event) {
    event.preventDefault()
    if (!message.trim()) return
    setBusy(true)
    setError('')
    try {
      const thread = await apiRequest('/api/v1/admin/support/threads', {
        method: 'POST',
        body: JSON.stringify({ user_id: composing.user_id, subject: 'Message from EkiMove operations', message: message.trim() }),
      })
      setNotice({ name: composing.name, thread: thread.id })
      setComposing(null)
      setMessage('')
    } catch (err) {
      setError(err.message || 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  const shown = (drivers || []).filter((d) => filter === 'all' || d.state !== 'offline')
  const counts = (drivers || []).reduce((acc, d) => ({ ...acc, [d.state]: (acc[d.state] || 0) + 1 }), {})

  return (
    <section className="card stack stack-sm" aria-labelledby="roster-title">
      <div className="row row-between">
        <h2 id="roster-title" className="section-title row" style={{ gap: 8 }}>
          <Users size={18} aria-hidden="true" /> Drivers
        </h2>
        <div className="chip-row">
          <button type="button" className={`chip ${filter === 'active' ? 'is-active' : ''}`} aria-pressed={filter === 'active'}
            onClick={() => setFilter('active')}>Online ({(counts.free || 0) + (counts.on_trip || 0)})</button>
          <button type="button" className={`chip ${filter === 'all' ? 'is-active' : ''}`} aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}>All ({drivers?.length || 0})</button>
        </div>
      </div>
      <p className="muted small">{counts.free || 0} free · {counts.on_trip || 0} on a trip · {counts.offline || 0} offline</p>
      <Alert tone="error">{error}</Alert>
      {notice && (
        <Alert tone="success">
          Message sent to {notice.name}. <Link className="text-link" to={`/admin/support?thread=${notice.thread}`}>Open the conversation</Link>
        </Alert>
      )}
      {drivers === null && <p className="muted small">Loading…</p>}
      {drivers && shown.length === 0 && <p className="muted small">No drivers online right now.</p>}
      <ul className="roster">
        {shown.map((d) => {
          const [label, tone] = STATE[d.state]
          return (
            <li key={d.driver_id} className="roster-item">
              <div className="roster-main">
                <p className="roster-name">{d.name} <span className={`badge ${tone}`}>{label}</span></p>
                <p className="muted small">
                  {d.vehicles.map((v) => `${vehicleLabel(v.type)} ${v.plate}`).join(' · ') || 'No approved vehicle'}
                  {d.offer_request_id ? ` · being offered #${d.offer_request_id}` : ''}
                  {d.state !== 'offline' && !d.location_fresh ? ' · location off' : ''}
                </p>
              </div>
              <div className="roster-actions">
                {d.phone && (
                  <a className="btn btn-sm" href={telLink(d.phone)} aria-label={`Call ${d.name}`}>
                    <Phone size={16} aria-hidden="true" /> Call
                  </a>
                )}
                <button type="button" className="btn btn-sm" aria-label={`Message ${d.name}`}
                  onClick={() => {
                    setComposing(d)
                    setNotice(null)
                  }}>
                  <MessageSquare size={16} aria-hidden="true" /> Message
                </button>
              </div>
              {composing?.driver_id === d.driver_id && (
                <form className="roster-compose" onSubmit={send}>
                  <label className="field">
                    <span className="field-label">Message to {d.name}</span>
                    <textarea className="input" rows={3} maxLength={2000} value={message} autoFocus
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="e.g. There's a passenger waiting at EKSU main gate. Can you go online?" />
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !message.trim()}>
                      {busy ? 'Sending…' : 'Send'}
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setComposing(null)}>Cancel</button>
                  </div>
                  <span className="field-hint">They get a phone notification and see it in Support.</span>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      <button type="button" className="btn btn-quiet btn-sm" onClick={load} style={{ alignSelf: 'flex-start' }}>Refresh</button>
    </section>
  )
}
