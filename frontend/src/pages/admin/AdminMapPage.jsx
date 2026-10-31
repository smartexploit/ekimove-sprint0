import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import LazyMap from '../../components/map/LazyMap.jsx'
import { getLiveMap } from '../../services/tripService.js'
import { formatDateTime } from '../../utils/format.js'

const REFRESH_MS = 10000
const STATE = {
  free: ['Free', 'driver'],
  offered: ['Offered a trip', 'driver-offered'],
  on_trip: ['On a trip', 'driver-busy'],
}

export default function AdminMapPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => getLiveMap()
    .then((result) => {
      setData(result)
      setError('')
    })
    .catch((err) => setError(err.message || 'Could not load the map.')), [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [load])

  const markers = useMemo(() => {
    if (!data) return []
    const list = data.drivers
      .filter((d) => d.latitude != null)
      .map((d) => ({
        id: `d${d.driver_id}`,
        kind: d.location_stale ? 'driver-stale' : STATE[d.state][1],
        latitude: d.latitude,
        longitude: d.longitude,
        label: d.name.split(' ').map((p) => p[0]).join('').slice(0, 2),
        popup: `${d.name} · ${d.phone}\n${d.plates.join(', ')}\n${STATE[d.state][0]}${d.location_stale ? ' · location over 5 min old' : ''}`,
      }))
    data.trips.forEach((t) => {
      if (t.pickup) list.push({ id: `p${t.ride_id}`, kind: 'pickup', ...t.pickup, popup: `Trip #${t.ride_id} pickup: ${t.pickup.name}` })
    })
    return list
  }, [data])

  const located = data?.drivers.filter((d) => d.latitude != null).length || 0

  return (
    <AdminShell
      title="Live map"
      description="Online drivers and live trips. Updates every 10 seconds."
      actions={
        <button type="button" className="btn btn-sm" onClick={load}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      }
    >
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        {data && (
          <>
            <div className="stat-grid">
              <div className="stat"><p className="stat-label">Drivers online</p><p className="stat-value">{data.drivers.length}</p>
                <p className="stat-note">{located} sharing location</p></div>
              <div className="stat"><p className="stat-label">Free</p><p className="stat-value">{data.drivers.filter((d) => d.state === 'free').length}</p></div>
              <div className="stat"><p className="stat-label">On a trip</p><p className="stat-value">{data.drivers.filter((d) => d.state === 'on_trip').length}</p></div>
              <div className="stat"><p className="stat-label">Live trips</p><p className="stat-value">{data.trips.length}</p></div>
            </div>
            <div className="map-legend small" aria-hidden="true">
              <span><i className="map-pin map-pin-driver" /> Free</span>
              <span><i className="map-pin map-pin-offered" /> Offered</span>
              <span><i className="map-pin map-pin-busy" /> On a trip</span>
              <span><i className="map-pin map-pin-stale" /> Location old</span>
              <span><i className="map-pin map-pin-pickup" /> Pickup</span>
            </div>
            <LazyMap markers={markers} height={460} label="Online drivers and pickups on a map" />

            <section className="stack stack-sm" aria-labelledby="online-title">
              <h2 id="online-title" className="section-title">Online drivers</h2>
              {data.drivers.length === 0 ? (
                <p className="card muted small">No drivers are online right now.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {data.drivers.map((d) => (
                    <li className="list-item" key={d.driver_id}>
                      <div className="list-item-main">
                        <p className="list-item-title">
                          <Link className="text-link" to={`/admin/people?role=driver&id=${d.user_id}`}>{d.name}</Link>
                        </p>
                        <p className="list-item-meta">
                          {d.phone} · {d.plates.join(', ')} ·{' '}
                          {d.location_updated_at ? `location ${formatDateTime(d.location_updated_at)}` : 'not sharing location'}
                        </p>
                      </div>
                      <span className={`badge ${d.state === 'on_trip' ? 'badge-red' : d.state === 'offered' ? 'badge-gold' : 'badge-green'}`}>
                        {STATE[d.state][0]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="stack stack-sm" aria-labelledby="trips-title">
              <h2 id="trips-title" className="section-title">Live trips</h2>
              {data.trips.length === 0 ? (
                <p className="card muted small">No trips in progress.</p>
              ) : (
                <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {data.trips.map((t) => (
                    <li className="list-item" key={t.ride_id}>
                      <div className="list-item-main">
                        <p className="list-item-title">#{t.ride_id} · {t.route}</p>
                        <p className="list-item-meta">Passenger {t.passenger} ({t.passenger_phone}) · Driver {t.driver}</p>
                      </div>
                      <StatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminShell>
  )
}
