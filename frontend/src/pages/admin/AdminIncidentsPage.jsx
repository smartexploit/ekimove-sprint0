import { useCallback, useEffect, useState } from 'react'
import AppPage from '../../layouts/AppPage.jsx'
import { apiRequest } from '../../services/authService.js'

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

    if (!window.confirm(`Are you sure you want to ${action}? Record your review note before proceeding.`)) {
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
        `Incident #${incident.id} updated to "${result.status}". ` +
        'The ride remains under safety review until separately authorized.',
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
    <AppPage
      title="Incident Management"
      description="Review passenger and driver SOS reports, document investigations, and record incident resolutions."
      sectionTitle="Safety incident register"
      sectionText="Only authorized super-admins should review these reports. Investigate the circumstances and document the decision."
    >
      <div className="app-panel">
        <p>
          <strong>Safety control:</strong> Resolving an incident does not
          automatically restore its ride to normal operation. A separate
          authorized safety decision is required.
        </p>

        <div className="app-page-actions">
          <button
            type="button"
            onClick={() => { loadIncidents() }}
            disabled={loading || busyId !== null}
          >
            {loading ? 'Loading…' : 'Refresh incidents'}
          </button>
        </div>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {loading ? (
          <p>Loading incident reports…</p>
        ) : incidents.length === 0 ? (
          <p>No incident reports were returned by the service.</p>
        ) : (
          <div className="app-list">
            {incidents.map((incident) => (
              <section className="app-panel" key={incident.id}>
                <h3>Incident #{incident.id}</h3>

                <p><strong>Ride:</strong> #{incident.ride_id}</p>
                <p><strong>Severity:</strong> {incident.severity}</p>
                <p><strong>Status:</strong> {incident.status}</p>
                <p><strong>Reporter user ID:</strong> {incident.reporter_user_id}</p>
                <p><strong>Reported:</strong> {incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Unavailable'}</p>
                <p><strong>Description:</strong></p>
                <p>{incident.description || 'No description supplied.'}</p>

                {incident.status !== 'resolved' ? (
                  <>
                    <label htmlFor={`incident-note-${incident.id}`}>
                      Review note
                    </label>
                    <textarea
                      id={`incident-note-${incident.id}`}
                      rows={3}
                      maxLength={1000}
                      value={notes[incident.id] || ''}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [incident.id]: event.target.value,
                        }))
                      }
                      placeholder="Document the investigation, findings, or resolution (minimum 5 characters)"
                      disabled={busyId !== null}
                    />

                    <div className="app-page-actions">
                      {incident.status !== 'investigating' && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => updateIncident(incident, 'investigating')}
                        >
                          {busyId === incident.id ? 'Updating…' : 'Investigate'}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => updateIncident(incident, 'resolved')}
                      >
                        {busyId === incident.id ? 'Updating…' : 'Resolve incident'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p role="status">
                    This incident is marked resolved. Ride restoration, if
                    appropriate, remains a separate safety decision.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </AppPage>
  )
}
