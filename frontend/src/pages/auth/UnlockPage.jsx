import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import AuthLayout from '../../layouts/AuthLayout.jsx'
import Alert from '../../components/ui/Alert.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import {
  clearDevice, describeDevice, getCurrentUser, getDevice, logoutPassenger, setDevicePin, unlockDevice,
} from '../../services/authService.js'
import { homePathForRole } from '../../utils/roles.js'
import { IDLE_MINUTES } from '../../utils/session.js'

function safeReturnPath(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/unlock')) return null
  return value
}

const digits = (value) => value.replace(/\D/g, '').slice(0, 6)

/**
 * "Welcome back": a remembered phone signs in with the password or the
 * quick PIN chosen on this phone, instead of the full sign-in form.
 */
export default function UnlockPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = safeReturnPath(location.state?.from)
  const [device, setDevice] = useState(getDevice)
  const [mode, setMode] = useState(getDevice()?.has_pin ? 'pin' : 'password')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('unlock')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [user, setUser] = useState(null)
  const pinRef = useRef(null)

  useEffect(() => {
    let active = true
    if (!getDevice()) {
      navigate('/login', { replace: true })
      return undefined
    }
    describeDevice()
      .then((info) => {
        if (!active || !info) return
        setDevice(info)
        setMode((current) => (info.has_pin ? current : 'password'))
      })
      .catch((err) => {
        if (active && !getDevice()) navigate('/login', { replace: true, state: { notice: err.message } })
      })
    return () => {
      active = false
    }
  }, [navigate])

  function goOn(signedIn) {
    const home = homePathForRole(signedIn.role)
    const allowed = returnTo && (signedIn.role === 'driver' ? returnTo.startsWith('/driver') : !returnTo.startsWith('/admin'))
    navigate(allowed ? returnTo : home, { replace: true })
  }

  async function unlock(event) {
    event.preventDefault()
    setError('')
    if (mode === 'pin' && pin.length < 4) return setError('Enter your PIN.')
    if (mode === 'password' && !password) return setError('Enter your password.')
    setBusy(true)
    try {
      const result = await unlockDevice(mode === 'pin' ? { pin } : { password })
      const signedIn = await getCurrentUser()
      setUser(signedIn)
      if (!result.has_pin) setStep('pin')
      else goOn(signedIn)
    } catch (err) {
      setPin('')
      setError(err.message || 'Could not sign you in.')
      if (!getDevice()) navigate('/login', { replace: true, state: { notice: err.message } })
    } finally {
      setBusy(false)
    }
  }

  async function savePin(event) {
    event.preventDefault()
    setError('')
    if (newPin.length < 4) return setError('Choose 4 to 6 digits.')
    if (newPin !== confirmPin) return setError('The two PINs don’t match.')
    setBusy(true)
    try {
      await setDevicePin(newPin)
      goOn(user)
    } catch (err) {
      setError(err.message || 'Could not save the PIN.')
    } finally {
      setBusy(false)
    }
  }

  function otherAccount() {
    clearDevice()
    logoutPassenger()
    navigate('/login', { replace: true })
  }

  if (!device) return null
  const first = device.first_name || 'there'

  if (step === 'pin') {
    return (
      <AuthLayout title={`Welcome back, ${first}.`} intro="Unlock faster next time." heading="Set a quick PIN"
        subheading="Choose 4–6 digits to unlock EkiMove on this phone instead of typing your password.">
        <form className="form" onSubmit={savePin}>
          <label className="field">
            <span className="field-label">New PIN</span>
            <input className="input pin-input" type="password" inputMode="numeric" autoComplete="new-password"
              value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} placeholder="••••" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Type it again</span>
            <input className="input pin-input" type="password" inputMode="numeric" autoComplete="new-password"
              value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} placeholder="••••" />
            <span className="field-hint">Avoid easy PINs like 1234 or your birthday. It only works on this phone.</span>
          </label>
          <Alert tone="error">{error}</Alert>
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save PIN'}
          </button>
          <button className="btn btn-quiet btn-block" type="button" onClick={() => goOn(user)}>Not now</button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={`Welcome back, ${first}.`} intro="Your next journey around Ekiti starts here."
      heading={`Hi ${first}`}
      subheading={`Signed in on this phone as ${device.account || 'your account'}. ${mode === 'pin'
        ? 'Enter your PIN to continue.' : 'Enter your password to continue.'}`}>
      {new URLSearchParams(location.search).get('reason') === 'timeout' && (
        <Alert tone="info">EkiMove locked after {IDLE_MINUTES} minutes without activity, to keep your account safe.</Alert>
      )}
      <form className="form" onSubmit={unlock}>
        {mode === 'pin' ? (
          <label className="field">
            <span className="field-label">PIN</span>
            <input ref={pinRef} className="input pin-input" type="password" inputMode="numeric"
              autoComplete="one-time-code" value={pin} placeholder="••••" autoFocus
              onChange={(e) => setPin(digits(e.target.value))} />
          </label>
        ) : (
          <div className="field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="unlock-password">Password</label>
              <Link className="text-link small" to="/forgot-password">Forgot password?</Link>
            </div>
            <PasswordInput id="unlock-password" autoComplete="current-password" value={password} maxLength={256}
              onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required autoFocus />
          </div>
        )}
        <Alert tone="error">{error}</Alert>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
          <KeyRound size={18} aria-hidden="true" /> {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {device.has_pin && (
          <button type="button" className="btn btn-quiet btn-block" onClick={() => {
            setMode(mode === 'pin' ? 'password' : 'pin')
            setError('')
          }}>{mode === 'pin' ? 'Use my password instead' : 'Use my PIN instead'}</button>
        )}
      </form>
      <p className="auth-switch">
        Not {first}? <button type="button" className="text-link link-button" onClick={otherAccount}>Sign in with another account</button>
      </p>
    </AuthLayout>
  )
}
