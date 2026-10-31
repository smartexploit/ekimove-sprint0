import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { refreshSession } from '../services/accountService.js'
import { logoutPassenger, tokenSecondsLeft } from '../services/authService.js'
import { IDLE_MINUTES } from '../utils/session.js'

const IDLE_MS = IDLE_MINUTES * 60 * 1000
const WARN_MS = 60 * 1000
const REFRESH_WHEN_SECONDS_LEFT = 5 * 60
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart']

/**
 * Signs people out of the app (including the installed PWA) after a period
 * of inactivity, with a one-minute warning. While they're active, their
 * session is quietly renewed so they aren't thrown out mid-task.
 */
export default function SessionTimeout() {
  const navigate = useNavigate()
  const lastActivity = useRef(0)
  const refreshing = useRef(false)
  const [secondsLeft, setSecondsLeft] = useState(null)

  const signOut = useCallback(() => {
    logoutPassenger()
    navigate('/login?reason=timeout', { replace: true })
  }, [navigate])

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now()
    setSecondsLeft(null)
  }, [])

  useEffect(() => {
    lastActivity.current = Date.now()
    const onActivity = () => {
      // While the warning is showing, only the button keeps the session.
      if (Date.now() - lastActivity.current < IDLE_MS - WARN_MS) lastActivity.current = Date.now()
    }
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))

    const tick = () => {
      const idle = Date.now() - lastActivity.current
      if (idle >= IDLE_MS || tokenSecondsLeft() === 0) {
        signOut()
        return
      }
      if (idle >= IDLE_MS - WARN_MS) {
        setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000))
        return
      }
      setSecondsLeft(null)
      if (!refreshing.current && tokenSecondsLeft() < REFRESH_WHEN_SECONDS_LEFT) {
        refreshing.current = true
        refreshSession().catch(() => {}).finally(() => { refreshing.current = false })
      }
    }

    // Phones pause timers in the background: check as soon as the app returns.
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(tick, 1000)
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [signOut])

  if (secondsLeft == null) return null

  return (
    <div className="session-warning" role="alertdialog" aria-modal="true" aria-labelledby="session-title"
      aria-describedby="session-text">
      <div className="session-card">
        <span className="instant-icon" aria-hidden="true"><Clock size={20} /></span>
        <h2 id="session-title" className="section-title">Still there?</h2>
        <p id="session-text" className="muted">
          For your safety, you'll be signed out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}.
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={stayActive} autoFocus>
            Stay signed in
          </button>
          <button type="button" className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
