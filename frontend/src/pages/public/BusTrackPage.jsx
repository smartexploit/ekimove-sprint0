import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PhoneCall, ShieldCheck } from 'lucide-react'
import Logo from '../../components/brand/Logo.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import LazyMap from '../../components/map/LazyMap.jsx'
import { getSharedBus } from '../../services/travelService.js'
import { travelTime } from '../../utils/travel.js'
import { whenVisible } from '../../utils/whenVisible.js'

/** Public page a student shares with family to follow their bus home. No sign-in. */
export default function BusTrackPage() {
  const { token } = useParams()
  const [view, setView] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = () => getSharedBus(token)
      .then((data) => {
        if (!active) return
        setView(data)
        setError('')
      })
      .catch((err) => active && setError(err.message || 'This trip link isn’t available.'))
    load()
    const timer = window.setInterval(whenVisible(load), 20000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [token])

  const markers = useMemo(() => (view?.bus_location ? [{
    id: 'bus', kind: 'driver', latitude: view.bus_location.latitude, longitude: view.bus_location.longitude,
    label: 'BUS', popup: `EkiMove bus${view.plate_number ? ` · ${view.plate_number}` : ''}`,
  }] : []), [view])
  const names = view?.travellers?.join(' and ') || 'Your contact'

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
              <p className="eyebrow">Shared bus trip</p>
              <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>
                {names} {view.status === 'completed' ? 'travelled' : (view.travellers?.length > 1 ? 'are travelling' : 'is travelling')} home with EkiMove
              </h1>
            </div>
            <section className="card stack">
              <div className="row row-between">
                <StatusBadge kind="departure" status={view.status} />
                {view.status === 'departed' && <span className="muted small">Updates every 20 seconds</span>}
              </div>
              <p className="route-value">{view.origin} → {view.destination}</p>
              <dl className="rows small">
                <div><dt>Leaves</dt><dd>{travelTime(view.departs_at)} from {view.pickup_spot}</dd></div>
                {view.drop_off && <div><dt>Drop-off</dt><dd>{view.drop_off}</dd></div>}
                {view.departed_at && <div><dt>Left at</dt><dd>{travelTime(view.departed_at)}</dd></div>}
                {view.completed_at && <div><dt>Arrived</dt><dd>{travelTime(view.completed_at)}</dd></div>}
                <div><dt>Boarded</dt><dd>{view.boarded ? 'Yes' : 'Not yet'}</dd></div>
                {view.plate_number && <div><dt>Bus</dt><dd>{view.vehicle_name ? `${view.vehicle_name} · ` : ''}<span className="plate plate-light">{view.plate_number}</span></dd></div>}
                {view.driver_name && <div><dt>Driver</dt><dd>{view.driver_name}</dd></div>}
              </dl>
              {view.status === 'departed' && !view.bus_location && (
                <p className="muted small">The bus’s location will show here once it’s on the road.</p>
              )}
              {view.bus_location?.stale && (
                <p className="muted small">The bus’s location hasn’t updated for a while (weak network on the road is common).</p>
              )}
              {markers.length > 0 && <LazyMap markers={markers} height={300} label="Where the bus is" />}
            </section>
            <section className="card stack stack-sm">
              <p className="row" style={{ gap: 8, fontWeight: 800 }}>
                <ShieldCheck size={18} aria-hidden="true" /> Worried about this trip?
              </p>
              <p className="small">
                Call your contact first. In an emergency, call 112.
                {view.support_phone ? ' You can also call the EkiMove team.' : ''}
              </p>
              <div className="row">
                <a className="btn btn-sm" href="tel:112"><PhoneCall size={16} aria-hidden="true" /> Call 112</a>
                {view.support_phone && (
                  <a className="btn btn-sm" href={`tel:${view.support_phone}`}><PhoneCall size={16} aria-hidden="true" /> Call EkiMove</a>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
