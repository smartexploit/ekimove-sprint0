import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessageCircle, Package } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { listLoadRequests, sendLoadQuote } from '../../services/accountService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'

const FILTERS = [
  ['quote_requested', 'Need a quote'],
  ['quoted', 'Quote sent'],
  ['requested', 'Accepted, need a driver'],
  ['all', 'All'],
]

function QuoteForm({ load, onSent }) {
  const [amount, setAmount] = useState(load.quoted_fare ? String(Math.round(Number(load.quoted_fare))) : '')
  const [terms, setTerms] = useState(load.quote_terms || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Enter the agreed price in naira.')
    if (terms.trim().length < 3) return setError('Write the terms you agreed (what is included, timing).')
    setBusy(true)
    setError('')
    try {
      await sendLoadQuote(load.id, value, terms.trim())
      onSent()
    } catch (err) {
      setError(err.message || 'Could not send the quote.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack stack-sm" onSubmit={submit}>
      <Alert tone="error">{error}</Alert>
      <label className="field">
        <span className="field-label">Agreed price (₦)</span>
        <input className="input" inputMode="numeric" value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 25000" />
      </label>
      <label className="field">
        <span className="field-label">Terms</span>
        <textarea className="textarea" rows={3} maxLength={1500} value={terms}
          onChange={(event) => setTerms(event.target.value)}
          placeholder="e.g. Includes 2 loaders, up to 3 hours, one trip. Customer pays through EkiMove." />
      </label>
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Sending…' : load.status === 'quoted' ? 'Update quote' : 'Send quote'}
        </button>
      </div>
    </form>
  )
}

export default function AdminLoadsPage() {
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.some(([value]) => value === params.get('status')) ? params.get('status') : 'quote_requested'
  const [loads, setLoads] = useState({ loaded: false, list: [] })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => listLoadRequests(filter)
    .then((list) => setLoads({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch((err) => setError(err.message || 'Could not load bookings.')), [filter])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    return () => {
      active = false
    }
  }, [load])

  return (
    <AdminShell
      title="Load bookings"
      description="Vans, big cars and dyna trucks. Agree the price in the support chat, then send the quote here."
    >
      <div className="stack">
        <div className="chip-row" aria-label="Filter">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" className={`chip ${filter === value ? 'is-active' : ''}`}
              aria-pressed={filter === value} onClick={() => setParams(value === 'quote_requested' ? {} : { status: value })}>
              {label}
            </button>
          ))}
        </div>
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>
        {loads.loaded && loads.list.length === 0 ? (
          <div className="card empty">
            <span className="empty-icon"><Package size={28} aria-hidden="true" /></span>
            <p className="muted">No load bookings here.</p>
          </div>
        ) : (
          <div className="grid grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))' }}>
            {loads.list.map((item) => (
              <article className="card stack" key={item.id}>
                <div className="row row-between">
                  <p className="list-item-title" style={{ minWidth: 0 }}>#{item.id} · {item.vehicle_label}</p>
                  <StatusBadge status={item.status} />
                </div>
                <dl className="rows small">
                  <div><dt>Customer</dt><dd>{item.customer ? `${item.customer.name} · ${item.customer.phone}` : '—'}</dd></div>
                  <div><dt>From</dt><dd>{item.origin_text}</dd></div>
                  <div><dt>To</dt><dd>{item.destination_text}</dd></div>
                  <div><dt>When</dt><dd>{item.scheduled_for ? formatDateTime(item.scheduled_for) : 'As soon as possible'}</dd></div>
                  {item.quoted_fare && <div><dt>Quote</dt><dd>{formatNaira(item.quoted_fare, { decimals: 0 })}</dd></div>}
                </dl>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}><strong>Load:</strong> {item.load_description}</p>
                {item.support_thread_id && (
                  <div>
                    <Link className="btn btn-sm" to={`/admin/support?thread=${item.support_thread_id}`}>
                      <MessageCircle size={16} aria-hidden="true" /> Open chat with customer
                    </Link>
                  </div>
                )}
                {['quote_requested', 'quoted'].includes(item.status) && (
                  <QuoteForm load={item} onSent={() => {
                    setNotice(`Quote sent for booking #${item.id}. The customer sees it in the app and in chat.`)
                    load()
                  }} />
                )}
                {item.status === 'requested' && (
                  <p className="small">
                    Accepted. Assign a driver with a matching vehicle in{' '}
                    <Link className="text-link" to="/admin/dispatch">Dispatch</Link>.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
