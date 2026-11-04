import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'

const STATUS = {
  fail: { label: 'Must fix', Icon: XCircle },
  warn: { label: 'Recommended', Icon: AlertTriangle },
  manual: { label: 'Check yourself', Icon: ClipboardCheck },
  ok: { label: 'Ready', Icon: CheckCircle2 },
}
const ORDER = { fail: 0, warn: 1, manual: 2, ok: 3 }

export default function AdminLaunchPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await apiRequest('/api/v1/admin/launch-checklist'))
    } catch (err) {
      setError(err.message || 'Could not load the checklist.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/admin/launch-checklist')
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message || 'Could not load the checklist.'))
    return () => {
      active = false
    }
  }, [])

  const groups = useMemo(() => {
    if (!data) return []
    const map = new Map()
    data.items
      .filter((item) => showAll || item.status !== 'ok')
      .forEach((item) => map.set(item.group, [...(map.get(item.group) || []), item]))
    return [...map.entries()].map(([group, items]) => [group, items.sort((a, b) => ORDER[a.status] - ORDER[b.status])])
  }, [data, showAll])

  const counts = data?.counts || {}
  return (
    <AdminShell title="Launch checklist"
      description="What's ready for real riders and drivers, and what still needs doing. Keys and passwords are never shown here."
      actions={(
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Checking…' : 'Check again'}
        </button>
      )}>
      <Alert tone="error">{error}</Alert>
      {!data && !error && <p className="muted">Checking…</p>}
      {data && (
        <>
          <section className={`card launch-summary ${data.ready ? 'is-ready' : ''}`}>
            <div>
              <h2>{data.ready ? 'Ready for a pilot' : `${counts.fail} thing${counts.fail === 1 ? '' : 's'} to fix before launch`}</h2>
              <p className="muted small">
                {counts.ok} ready · {counts.warn} recommended · {counts.manual} to check yourself
              </p>
            </div>
            <div className="launch-bar" aria-hidden="true">
              {['ok', 'warn', 'manual', 'fail'].map((key) => counts[key] > 0 && (
                <span key={key} className={`launch-bar-${key}`} style={{ flexGrow: counts[key] }} />
              ))}
            </div>
          </section>

          <div className="chip-row" role="group" aria-label="Show">
            <button type="button" className={`chip ${!showAll ? 'is-active' : ''}`} aria-pressed={!showAll}
              onClick={() => setShowAll(false)}>To do ({data.items.length - counts.ok})</button>
            <button type="button" className={`chip ${showAll ? 'is-active' : ''}`} aria-pressed={showAll}
              onClick={() => setShowAll(true)}>Everything ({data.items.length})</button>
          </div>

          {groups.length === 0 && <p className="card muted">Everything on the list is ready.</p>}
          {groups.map(([group, items]) => (
            <section key={group} className="card stack">
              <h2 className="section-title">{group}</h2>
              <ul className="launch-list">
                {items.map((item) => {
                  const { label, Icon } = STATUS[item.status]
                  return (
                    <li key={item.key} className={`launch-item is-${item.status}`}>
                      <Icon size={22} aria-hidden="true" className="launch-icon" />
                      <div>
                        <p className="launch-title">
                          <strong>{item.label}</strong> <span className="launch-tag">{label}</span>
                        </p>
                        <p className="launch-detail">{item.detail}</p>
                        {item.fix && <p className="launch-fix"><strong>What to do:</strong> {item.fix}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </AdminShell>
  )
}
