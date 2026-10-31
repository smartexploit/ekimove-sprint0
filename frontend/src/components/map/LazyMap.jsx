import { Suspense, lazy } from 'react'

const LiveMap = lazy(() => import('./LiveMap.jsx'))

/** Loads the map code only when a map is actually shown. */
export default function LazyMap(props) {
  return (
    <Suspense fallback={<div className="live-map" style={{ height: props.height || 280 }} aria-hidden="true" />}>
      <LiveMap {...props} />
    </Suspense>
  )
}
