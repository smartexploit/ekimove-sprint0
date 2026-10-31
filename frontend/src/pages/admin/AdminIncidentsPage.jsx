import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import { apiRequest } from '../../services/authService.js'
import { formatDateTime, titleCase } from '../../utils/format.js'

export default function AdminIncidentsPage() {
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notes, setNotes] = useState({})
  const [busyId, setBusyId] = useState(null)

  const loadIncidents = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await apiRequest('/api/v1/admin/incidents')

      if (!Array.isArray(result)) {
        throw new Error('The incident endpoint returned an unexpected response.')
      }

      setIncidents(result)
    } catch (err) {
      setError(err.message || 'Could not load incident reports.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadIncidents()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadIncidents])

  async function updateIncident(incident, status) {
    const note = (notes[incident.id] || '').trim()

    if (note.length < 5) {
      setError('Enter a review note of at least 5 characters.')
      setNotice('')
      return
    }

    const action = status === 'investigating' ? 'mark this incident as investigating' : 'resolve this incident'

    if (!window.confirm(`Are you sure you want to ${action}? Your review note will be recorded.`)) {
      return
    }

    setBusyId(incident.id)
    setError('')
    setNotice('')

    try {
      const result = await apiRequest(
        `/api/v1/admin/incidents/${incident.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status, note }),
        },
      )

      setNotice(
        `Incident #${incident.id} is now "${result.status}". ` +
        'The ride stays under safety review until separately authorized.',
      )
      setNotes((current) => ({ ...current, [incident.id]: '' }))
      await loadIncidents()
    } catch (err) {
      setError(err.message || 'Could not update the incident.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AdminShell
      eyebrow="Safety"
      title="Incidents"
      description="SOS reports from passengers and drivers. Document what you find and how it was resolved."
      actions={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => { loadIncidents() }}
          disabled={loading || busyId !== null}
        >
          <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      <div className="stack">
        <Alert tone="info">
          Resolving an incident doesn't put its ride back into normal operation.
          That needs a separate, authorized safety decision.
        </Alert>
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{notice}</Alert>

        {loading ? (
          <div className="loading-block" role="status">
            <span className="spinner" aria-hidden="true" /> Loading incident reports…
          </div>
        ) : incidents.length === 0 ? (
          <div className="card empty">
            <span className="empty-icon"><ShieldCheck size={28} aria-hidden="true" /></span>
            <h2>No incidents</h2>
            <p className="muted">No incident reports have been raised.</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {incidents.map((incident) => (
              <section className="card stack" key={incident.id} aria-labelledby={`incident-${incident.id}`}>
                <div className="row row-between">
                  <h2 id={`incident-${incident.id}`} className="card-title">
                    Incident #{incident.id}
                  </h2>
                  <div className="row" style={{ gap: 6 }}>
                    {incident.severity && (
                      <span className={`badge ${incident.severity === 'critical' ? 'badge-red' : 'badge-gold'}`}>
                        {titleCase(incident.severity)}
                      </span>
                    )}
                    <StatusBadge status={incident.status} kind="incident" />
                  </div>
                </div>

                <p style={{ fontSize: 15 }}>{incident.description || 'No description supplied.'}</p>

                <dl className="rows">
                  <div><dt>Ride</dt><dd>#{incident.ride_id}</dd></div>
                  <div><dt>Reported by</dt><dd>User #{incident.reporter_user_id}</dd></div>
                  <div><dt>Reported</dt><dd>{incident.created_at ? formatDateTime(incident.created_at) : 'Unavailable'}</dd></div>
                </dl>

                {incident.status !== 'resolved' ? (
                  <>
                    <label className="field" htmlFor={`incident-note-${incident.id}`}>
                      <span className="field-label">Review note</span>
                      <textarea
                        id={`incident-note-${incident.id}`}
                        className="textarea"
                        rows={3}
                        maxLength={1000}
                        value={notes[incident.id] || ''}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [incident.id]: event.target.value,
                          }))
                        }
                        placeholder="What you found and what was done (at least 5 characters)"
                        disabled={busyId !== null}
                      />
                    </label>

                    <div className="row">
                      {incident.status !== 'investigating' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busyId !== null}
                          onClick={() => updateIncident(incident, 'investigating')}
                        >
                          {busyId === incident.id ? 'Updating…' : 'Mark investigating'}
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId !== null}
                        onClick={() => updateIncident(incident, 'resolved')}
                      >
                        {busyId === incident.id ? 'Updating…' : 'Resolve incident'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted small" role="status">
                    Resolved. Restoring the ride, if appropriate, is a separate safety decision.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
