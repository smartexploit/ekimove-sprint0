import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { currentSubscription, needsHomeScreen, pushSupported, turnOnNotifications } from '../../utils/push.js'

const DISMISS_KEY = 'ekimove.alertsPromptHiddenUntil'
const HIDE_DAYS = 2

function hiddenNow() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now()
  } catch {
    return false
  }
}

/**
 * Banner asking passengers and drivers to turn on phone notifications, so
 * calls ring and messages arrive even when EkiMove is closed.
 */
export default function AlertsPrompt({ role }) {
  const [state, setState] = useState('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.resolve().then(async () => {
      if (hiddenNow()) return active && setState('hidden')
      if (!pushSupported()) return active && setState(needsHomeScreen() ? 'home-screen' : 'hidden')
      if (Notification.permission === 'denied') return active && setState('blocked')
      const subscription = await currentSubscription().catch(() => null)
      return active && setState(subscription && Notification.permission === 'granted' ? 'hidden' : 'off')
    })
    return () => {
      active = false
    }
  }, [])

  if (state === 'checking' || state === 'hidden') return null

  const hide = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + HIDE_DAYS * 86400000))
    } catch {
      /* fine */
    }
    setState('hidden')
  }
  const who = role === 'driver' ? 'passengers' : 'your driver'

  return (
    <section className="alerts-prompt" aria-labelledby="alerts-prompt-title">
      <span className="alerts-prompt-icon" aria-hidden="true"><BellRing size={20} /></span>
      <div className="alerts-prompt-body">
        <h2 id="alerts-prompt-title">Hear calls and messages when EkiMove is closed</h2>
        {state === 'off' && (
          <p>Turn on notifications so your phone rings when {who} call{role === 'driver' ? '' : 's'} and buzzes for new
            messages{role === 'driver' ? ' and trip offers' : ''}.</p>
        )}
        {state === 'blocked' && (
          <p>Notifications are blocked for EkiMove. Open your browser or phone settings, allow notifications for
            ekimove.com.ng, then come back.</p>
        )}
        {state === 'home-screen' && (
          <p>On iPhone, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open EkiMove from your Home
            Screen, then turn notifications on.</p>
        )}
        {error && <p className="alerts-prompt-error" role="alert">{error}</p>}
        {state === 'off' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await turnOnNotifications()
              setState('hidden')
            } catch (err) {
              setError(err.message || 'Could not turn notifications on.')
              if (Notification.permission === 'denied') setState('blocked')
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>
        )}
      </div>
      <button type="button" className="icon-btn alerts-prompt-close" aria-label="Not now" onClick={hide}>
        <X size={18} />
      </button>
    </section>
  )
}
