import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import PasswordInput from '../../components/ui/PasswordInput.jsx'
import { changePassword, getProfile, updateProfile } from '../../services/accountService.js'
import { formatShortDate, initials } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

function DetailsForm({ profile, onSaved }) {
  const [form, setForm] = useState({ full_name: profile.full_name, email: profile.email || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await updateProfile({ full_name: form.full_name.trim(), email: form.email.trim() })
      onSaved(updated)
      setNotice('Your details are saved.')
    } catch (err) {
      setError(err.message || 'Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={save} aria-labelledby="details-title">
      <h2 id="details-title" className="section-title">Your details</h2>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <label className="field">
        <span className="field-label">Full name</span>
        <input className="input" autoComplete="name" minLength={2} maxLength={160} required
          value={form.full_name} onChange={(event) => setForm((f) => ({ ...f, full_name: event.target.value }))} />
        {profile.role === 'driver' && (
          <span className="field-hint">Passengers see your first name and last initial.</span>
        )}
      </label>
      <label className="field">
        <span className="field-label">Phone number</span>
        <input className="input" value={profile.phone} disabled readOnly />
        <span className="field-hint">To change your phone number, contact support.</span>
      </label>
      <label className="field">
        <span className="field-label">Email (optional)</span>
        <input className="input" type="email" autoComplete="email" maxLength={254}
          value={form.email} onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
          placeholder="For receipts and account messages" />
      </label>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  )
}

function PasswordField({ id, label, hint, ...props }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <PasswordInput id={id} {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function PasswordForm() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function save(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (form.next.length < 12) return setError('Use at least 12 characters for your new password.')
    if (form.next !== form.confirm) return setError("The new passwords don't match.")
    setBusy(true)
    try {
      await changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      setNotice('Password changed. Any other phone signed in to your account has been signed out.')
    } catch (err) {
      setError(err.message || 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={save} aria-labelledby="password-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true"><KeyRound size={20} /></span>
        <h2 id="password-title" className="section-title">Change password</h2>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <PasswordField id="current-password" label="Current password" autoComplete="current-password"
        value={form.current} onChange={(event) => setForm((f) => ({ ...f, current: event.target.value }))} required />
      <PasswordField id="new-password" label="New password" autoComplete="new-password"
        value={form.next} onChange={(event) => setForm((f) => ({ ...f, next: event.target.value }))} required
        hint="At least 12 characters." />
      <PasswordField id="confirm-password" label="Confirm new password" autoComplete="new-password"
        value={form.confirm} onChange={(event) => setForm((f) => ({ ...f, confirm: event.target.value }))} required />
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  )
}

export default function ProfilePage() {
  const { user } = useOutletContext()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getProfile()
      .then((data) => active && setProfile(data))
      .catch((err) => active && setError(err.message || 'Could not load your profile.'))
    return () => {
      active = false
    }
  }, [])

  const driver = profile?.driver

  return (
    <AppShell title="Your profile" description="Your account details and security.">
      <Alert tone="error">{error}</Alert>
      {!profile && !error && (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Loading your profile…
        </div>
      )}
      {profile && (
        <div className="two-col">
          <div className="stack">
            <section className="card profile-head" aria-label="Account summary">
              <span className="avatar avatar-lg" aria-hidden="true">{initials(profile.full_name)}</span>
              <div style={{ minWidth: 0 }}>
                <p className="profile-name">{profile.full_name}</p>
                <p className="muted small">
                  {profile.role === 'driver' ? 'Driver' : 'Passenger'} · {profile.phone}
                </p>
                <p className="muted small">Member since {formatShortDate(profile.joined_at)}</p>
              </div>
            </section>

            {driver && (
              <section className="card stack stack-sm" aria-labelledby="driver-title">
                <div className="row row-between">
                  <h2 id="driver-title" className="section-title">Driver account</h2>
                  <StatusBadge status={driver.verification_status} kind="verification" />
                </div>
                {driver.vehicles.map((vehicle) => (
                  <div className="row" key={vehicle.id} style={{ gap: 10 }}>
                    <span className="plate plate-light">{vehicle.plate_number}</span>
                    <span className="small">
                      {vehicleLabel(vehicle.vehicle_type)} · {vehicle.capacity}{' '}
                      {vehicle.capacity === 1 ? 'seat' : 'seats'} · {vehicle.is_approved ? 'approved' : 'awaiting approval'}
                    </span>
                  </div>
                ))}
                <p className="muted small">
                  To change your vehicle or plate number, <Link className="text-link" to="/support">contact support</Link>.
                </p>
                <div className="row">
                  <Link className="btn btn-sm" to="/driver/earnings">Earnings and bank account</Link>
                  <Link className="btn btn-sm" to="/driver/status">Online status</Link>
                </div>
              </section>
            )}

            <DetailsForm key={profile.id} profile={profile} onSaved={setProfile} />
          </div>
          <div className="stack">
            <PasswordForm />
            <section className="card stack stack-sm" aria-labelledby="privacy-title">
              <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <span className="instant-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
                <h2 id="privacy-title" className="section-title">Staying safe</h2>
              </div>
              <p className="muted small">
                EkiMove signs you out after a while without activity. EkiMove staff will never ask
                for your password or bank PIN.
              </p>
              <p className="muted small">
                Want your account removed? <Link className="text-link" to="/support">Message support</Link>.
              </p>
            </section>
            {user?.role === 'passenger' && (
              <Link className="card row" to="/my-rides" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
                <span className="instant-icon" aria-hidden="true"><UserRound size={20} /></span>
                <span className="section-title">Your rides and receipts</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}
