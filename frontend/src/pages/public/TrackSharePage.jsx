import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PhoneCall, ShieldCheck } from 'lucide-react'
import Logo from '../../components/brand/Logo.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import LazyMap from '../../components/map/LazyMap.jsx'
import { getSharedTrip } from '../../services/tripService.js'
import { etaText, tripMarkers } from '../../utils/tracking.js'
import { vehicleLabel } from '../../utils/vehicles.js'

/** Public page a passenger shares with a trusted contact. No sign-in. */
export default function TrackSharePage() {
  const { token } = useParams()
  const [view, setView] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = () => getSharedTrip(token)
      .then((data) => {
        if (!active) return
        setView(data)
        setError('')
      })
      .catch((err) => active && setError(err.message || 'This trip link isn’t available.'))
    load()
    const timer = window.setInterval(load, 10000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [token])

  const markers = useMemo(() => tripMarkers(view), [view])
  const ended = view && ['completed', 'cancelled'].includes(view.status)

  return (
    <div className="share-page">
      <header className="site-header site-header-solid">
        <div className="container site-nav"><Logo /></div>
      </header>
      <main className="container stack" style={{ padding: '20px 16px 40px', maxWidth: 640 }}>
        {error && !view && (
          <div className="card stack stack-sm">
            <h1 className="section-title">Trip link unavailable</h1>
            <p className="muted">{error}</p>
          </div>
        )}
        {view && (
          <>
            <div className="stack stack-sm">
              <p className="eyebrow">Shared trip</p>
              <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>
                {view.passenger_name || 'Your contact'} {ended ? 'took' : 'is on'} an EkiMove trip
              </h1>
            </div>
            <section className="card stack">
              <div className="row row-between">
                <StatusBadge status={view.status} />
                {!ended && <span className="muted small">Updates every 10 seconds</span>}
              </div>
              <p className="route-value">{view.pickup.name} → {view.destination.name}</p>
              <dl className="rows small">
                <div><dt>Driver</dt><dd>{view.driver.name || '—'}</dd></div>
                <div><dt>Vehicle</dt><dd>{vehicleLabel(view.driver.vehicle_type)}</dd></div>
                <div><dt>Plate</dt><dd><span className="plate plate-light">{view.driver.plate_number || '—'}</span></dd></div>
              </dl>
              {!ended && <p style={{ fontWeight: 800 }} aria-live="polite">{etaText(view)}</p>}
              {ended && <p className="muted">This trip has {view.status === 'completed' ? 'ended' : 'been cancelled'}.</p>}
              {(markers.length > 0 || view.trail.length > 1) && (
                <LazyMap markers={markers} trail={view.trail} height={300} label="The trip on a map" />
              )}
            </section>
            <section className="card stack stack-sm">
              <p className="row" style={{ gap: 8, fontWeight: 800 }}>
                <ShieldCheck size={18} aria-hidden="true" /> Worried about this trip?
              </p>
              <p className="small">
                Call your contact first. In an emergency, call 112. You can also reach EkiMove support.
              </p>
              <a className="btn btn-sm" href="tel:112"><PhoneCall size={16} aria-hidden="true" /> Call 112</a>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
