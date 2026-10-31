import { useEffect, useState } from 'react'
import { BadgeCheck, IdCard, PhoneCall } from 'lucide-react'
import Alert from '../ui/Alert.jsx'
import Select from '../ui/Select.jsx'
import { getMyVerification, saveEmergencyContact, submitVerification } from '../../services/tripService.js'
import { formatShortDate } from '../../utils/format.js'

export function EmergencyContactCard({ initial }) {
  const [name, setName] = useState(initial?.name || '')
  const [phone, setPhone] = useState(initial?.phone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveEmergencyContact(name.trim(), phone.trim())
      setNotice(name.trim() ? 'Saved. You can text them your live trip in one tap.' : 'Emergency contact removed.')
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={save} aria-labelledby="emergency-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true"><PhoneCall size={20} /></span>
        <div>
          <h2 id="emergency-title" className="section-title">Emergency contact</h2>
          <p className="muted small">Someone you trust. During a trip you can send them your live trip link.</p>
        </div>
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 180px' }}>
          <span className="field-label">Name</span>
          <input className="input" maxLength={160} value={name} onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Mum" />
        </label>
        <label className="field" style={{ flex: '1 1 180px' }}>
          <span className="field-label">Phone number</span>
          <input className="input" type="tel" inputMode="tel" maxLength={20} value={phone}
            onChange={(event) => setPhone(event.target.value)} placeholder="080…" />
        </label>
      </div>
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save emergency contact'}
        </button>
      </div>
    </form>
  )
}

export function VerificationCard() {
  const [state, setState] = useState(null)
  const [form, setForm] = useState({ id_type: 'nin', id_number: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getMyVerification().then((data) => active && setState(data)).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (!file) return setError('Add a clear photo of your ID.')
    setBusy(true)
    setError('')
    const data = new FormData()
    data.append('id_type', form.id_type)
    data.append('id_number', form.id_number.trim())
    data.append('id_photo', file)
    try {
      const result = await submitVerification(data)
      setState((current) => ({ ...current, ...result }))
    } catch (err) {
      setError(err.message || 'Could not send your ID.')
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  const canSubmit = ['not_submitted', 'rejected'].includes(state.status)

  return (
    <section className="card stack" aria-labelledby="verify-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="instant-icon" aria-hidden="true">
          {state.status === 'approved' ? <BadgeCheck size={20} /> : <IdCard size={20} />}
        </span>
        <div>
          <h2 id="verify-title" className="section-title">
            {state.status === 'approved' ? 'ID verified' : 'Verify your ID'}
          </h2>
          <p className="muted small">
            {state.status === 'approved'
              ? `${state.id_type_label} ${state.id_number} · verified ${formatShortDate(state.reviewed_at)}. Drivers see a verified badge.`
              : 'Drivers see when a passenger is verified, which makes trips safer for everyone.'}
            {state.required_to_book && state.status !== 'approved' && ' EkiMove currently requires this before booking.'}
          </p>
        </div>
      </div>
      {state.status === 'pending' && (
        <Alert tone="info">We’re checking your {state.id_type_label} ({state.id_number}). This usually takes a few hours.</Alert>
      )}
      {state.status === 'rejected' && (
        <Alert tone="warning">We couldn’t verify that ID: {state.review_note}. Please try again.</Alert>
      )}
      {canSubmit && (
        <form className="stack" onSubmit={submit}>
          <Alert tone="error">{error}</Alert>
          <label className="field">
            <span className="field-label">ID type</span>
            <Select value={form.id_type} onChange={(event) => setForm((f) => ({ ...f, id_type: event.target.value }))}>
              {state.id_types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">ID number</span>
            <input className="input" required maxLength={40} value={form.id_number} autoComplete="off"
              onChange={(event) => setForm((f) => ({ ...f, id_number: event.target.value }))}
              placeholder={form.id_type === 'nin' ? '11-digit NIN' : 'As printed on your ID'} />
          </label>
          <label className="field">
            <span className="field-label">Photo of your ID</span>
            <input className="input" type="file" accept="image/jpeg,image/png,image/webp" required
              onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <span className="field-hint">Clear and readable, max 5 MB. Only EkiMove staff can see it.</span>
          </label>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? 'Sending…' : 'Send for verification'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
