import { useEffect, useState } from 'react'
import { Phone } from 'lucide-react'
import { getCallConfig } from '../../services/callService.js'
import { useCalls } from './callContext.js'

/** "Call driver" / "Call passenger" during a trip. Numbers stay private. */
export default function CallButton({ rideId, other, name }) {
  const { startCall, busy } = useCalls()
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let active = true
    getCallConfig().then((config) => active && setEnabled(Boolean(config.enabled))).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!enabled) return null
  return (
    <button type="button" className="btn btn-call" disabled={busy}
      onClick={() => startCall(rideId, { role: other, name: name || (other === 'driver' ? 'Your driver' : 'Your passenger') })}>
      <Phone size={18} aria-hidden="true" /> Call {other}
    </button>
  )
}
