import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import { sendTestNotification } from '../../services/accountService.js'
import {
  currentSubscription,
  needsHomeScreen,
  pushSupported,
  turnOffNotifications,
  turnOnNotifications,
} from '../../utils/push.js'

const WHAT = {
  driver: 'in-app calls and messages, new trip offers, payments and support replies',
  passenger: 'in-app calls and messages, your driver’s arrival, payments, quotes and support replies',
  super_admin: 'SOS alerts and new support messages',
}

/** Turn phone notifications on or off for this device. */
export default function NotificationsCard({ role = 'passenger', compact = false }) {
  const [state, setState] = useState('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.resolve().then(async () => {
      if (!pushSupported()) return active && setState(needsHomeScreen() ? 'home-screen' : 'unsupported')
      if (Notification.permission === 'denied') return active && setState('blocked')
      const subscription = await currentSubscription().catch(() => null)
      return active && setState(subscription && Notification.permission === 'granted' ? 'on' : 'off')
    })
    return () => {
      active = false
    }
  }, [])

  async function run(action) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setState('blocked')
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () => run(async () => {
    await turnOnNotifications()
    setState('on')
    setNotice('Notifications are on for this phone.')
  })
  const turnOff = () => run(async () => {
    await turnOffNotifications()
    setState('off')
  })
  const test = () => run(async () => {
    await sendTestNotification()
    setNotice('Test sent. It should appear in a few seconds.')
  })

  if (state === 'checking') return null

  return (
    <section className="card stack stack-sm" aria-labelledby="notify-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true"><BellRing size={20} /></span>
        <h2 id="notify-title" className="section-title">Phone notifications</h2>
      </div>
      {!compact && <p className="muted small">Get alerts about {WHAT[role] || WHAT.passenger}, even when EkiMove is closed.</p>}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      {state === 'home-screen' && (
        <p className="small">
          On iPhone, first add EkiMove to your Home Screen: tap <strong>Share</strong>, then
          <strong> Add to Home Screen</strong>. Open EkiMove from there and turn notifications on here.
        </p>
      )}
      {state === 'unsupported' && <p className="muted small">This browser can’t show notifications. Try Chrome or the Home Screen app.</p>}
      {state === 'blocked' && (
        <p className="small">Notifications are blocked for EkiMove. Allow them in your browser or phone settings, then reload.</p>
      )}
      {state === 'off' && (
        <div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={turnOn}>
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </div>
      )}
      {state === 'on' && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="badge badge-green">On for this phone</span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={test}>Send a test</button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={turnOff}>Turn off</button>
        </div>
      )}
    </section>
  )
}
