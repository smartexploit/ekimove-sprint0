import { Suspense, lazy, useEffect, useState } from 'react'
import { getMapConfig } from '../../services/tripService.js'

const LeafletMap = lazy(() => import('./LeafletMap.jsx'))
const GoogleMap = lazy(() => import('./GoogleMap.jsx'))

const FALLBACK = {
  provider: 'tiles',
  tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  center: { latitude: 7.6233, longitude: 5.2214 },
}

let configPromise = null
function loadMapConfig() {
  if (!configPromise) configPromise = getMapConfig().catch(() => FALLBACK)
  return configPromise
}

/**
 * The app's map: markers ({ id, latitude, longitude, kind, label, popup }),
 * an optional trail ([lat, lng] pairs) and tap-to-pick. Google Maps when
 * EkiMove's Google key is set (Google's terms: Google search results and
 * distances go on a Google map), otherwise the plain tile map; it also
 * falls back to the tile map if Google can't load.
 */
export default function LiveMap(props) {
  const [config, setConfig] = useState(null)
  const [googleFailed, setGoogleFailed] = useState(false)

  useEffect(() => {
    let active = true
    loadMapConfig().then((c) => active && setConfig(c))
    return () => {
      active = false
    }
  }, [])

  const placeholder = <div className="live-map" style={{ height: props.height || 280 }} aria-hidden="true" />
  if (!config) return placeholder
  const google = config.provider === 'google' && config.google_key && !googleFailed
  return (
    <Suspense fallback={placeholder}>
      {google
        ? <GoogleMap {...props} config={config} onFail={() => setGoogleFailed(true)} />
        : <LeafletMap {...props} config={config} />}
    </Suspense>
  )
}
