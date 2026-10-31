import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** Tells people when their phone loses connection. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} aria-hidden="true" />
      You're offline. Rides and payments will update when you reconnect.
    </div>
  )
}
