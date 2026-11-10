import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, Camera, Download, IdCard, RefreshCw, ShieldOff } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { apiRequest, downloadFile, fetchImageUrl } from '../../services/authService.js'
import { nameTyping } from '../../utils/inputRules.js'

const STATUS = {
  valid: ['Valid', 'badge-green'],
  expired: ['Expired', 'badge-gold'],
  revoked: ['Cancelled', 'badge-red'],
}

function niceDate(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function useImage(path) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let made = ''
    let active = true
    if (path) {
      fetchImageUrl(path).then((u) => {
        made = u
        if (active) setUrl(u)
      }).catch(() => {})
    }
    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [path])
  return path ? url : ''
}

function IssueForm({ nextNumber, onIssued }) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [expires, setExpires] = useState('')
  const [number, setNumber] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('full_name', name)
    form.append('title', title)
    if (expires) form.append('expires_on', expires)
    if (number.trim()) form.append('staff_number', number.trim())
    if (photo) form.append('photo', photo)
    try {
      const card = await apiRequest('/api/v1/admin/staff-cards', { method: 'POST', body: form })
      setName('')
      setTitle('')
      setExpires('')
      setNumber('')
      setPhoto(null)
      event.target.reset()
      onIssued(card)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack stack-sm" onSubmit={submit} aria-labelledby="card-new-title">
      <h2 id="card-new-title" className="card-title">Issue a card <span className="muted small">· next number {nextNumber}</span></h2>
      <div className="form-grid">
        <label className="field" htmlFor="card-name">
          <span className="field-label">Full name</span>
          <input id="card-name" className="input" required maxLength={120} value={name}
            onChange={(e) => setName(nameTyping(e.target.value))} placeholder="e.g. Faith Ogunlade" />
        </label>
        <label className="field" htmlFor="card-title">
          <span className="field-label">Job title</span>
          <input id="card-title" className="input" required maxLength={80} value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Founder & CEO" />
        </label>
        <label className="field" htmlFor="card-photo">
          <span className="field-label">Passport photo</span>
          <input id="card-photo" className="input" type="file" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          <span className="field-hint">Shown when someone checks the card. JPEG, PNG or WebP, up to 5 MB.</span>
        </label>
        <label className="field" htmlFor="card-number">
          <span className="field-label">Staff ID (optional)</span>
          <input id="card-number" className="input" maxLength={12} value={number} placeholder={nextNumber}
            onChange={(e) => setNumber(e.target.value.toUpperCase())} />
          <span className="field-hint">Leave empty to use {nextNumber}.</span>
        </label>
        <label className="field" htmlFor="card-expires">
          <span className="field-label">Valid until (optional)</span>
          <input id="card-expires" className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <span className="field-hint">Leave empty for one year from today.</span>
        </label>
      </div>
      <Alert tone="error">{error}</Alert>
      <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        <IdCard size={18} aria-hidden="true" /> {busy ? 'Issuing…' : 'Issue card'}
      </button>
    </form>
  )
}

function CardRow({ card, onChanged }) {
  const [photoVersion, setPhotoVersion] = useState(0)
  const photo = useImage(card.has_photo ? `/api/v1/admin/staff-cards/${card.id}/photo?v=${photoVersion}` : '')
  const qr = useImage(card.status === 'revoked' ? '' : `/api/v1/admin/staff-cards/${card.id}/qr.svg`)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [label, tone] = STATUS[card.status]

  async function changePhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy('photo')
    setError('')
    const form = new FormData()
    form.append('photo', file)
    try {
      await apiRequest(`/api/v1/admin/staff-cards/${card.id}/photo`, { method: 'POST', body: form })
      setPhotoVersion((v) => v + 1)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  async function act(kind) {
    let body = {}
    if (kind === 'revoke') {
      const reason = window.prompt(`Why cancel ${card.full_name}’s card? (e.g. lost, left EkiMove)`)
      if (!reason || reason.trim().length < 3) return
      body = { reason: reason.trim() }
    } else if (!window.confirm(`Print a replacement card for ${card.full_name}? The current card stops working.`)) {
      return
    }
    setBusy(kind)
    setError('')
    try {
      await apiRequest(`/api/v1/admin/staff-cards/${card.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) })
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <article className={`card staff-card-row ${card.status === 'revoked' ? 'is-revoked' : ''}`}>
      <div className="staff-card-photo">{photo ? <img src={photo} alt={`Photo of ${card.full_name}`} /> : <IdCard size={28} aria-hidden="true" />}</div>
      <div className="stack stack-sm" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{card.full_name}</strong>
          <span className={`badge ${tone}`}>{label}</span>
        </div>
        <p className="small muted">{card.title} · {card.staff_number}</p>
        <p className="small">Code <strong className="staff-code">{card.code}</strong> · valid until {niceDate(card.expires_on)}</p>
        {card.status === 'revoked' && card.revoked_reason && <p className="small muted">Cancelled: {card.revoked_reason}</p>}
        <Alert tone="error">{error}</Alert>
        {card.status !== 'revoked' && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/api/v1/admin/staff-cards/${card.id}/qr.svg`, 'qr.svg').catch((e) => setError(e.message))}>
              <Download size={16} aria-hidden="true" /> QR (SVG)
            </button>
            <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/api/v1/admin/staff-cards/${card.id}/qr.png`, 'qr.png').catch((e) => setError(e.message))}>
              <Download size={16} aria-hidden="true" /> QR (PNG)
            </button>
            <label className={`btn btn-sm ${busy ? 'is-disabled' : ''}`} htmlFor={`card-photo-${card.id}`}>
              <Camera size={16} aria-hidden="true" /> {busy === 'photo' ? 'Uploading…' : 'Change photo'}
            </label>
            <input id={`card-photo-${card.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              disabled={Boolean(busy)} onChange={changePhoto} />
            <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => act('reissue')}>
              <RefreshCw size={16} aria-hidden="true" /> {busy === 'reissue' ? 'Replacing…' : 'Replace card'}
            </button>
            <button type="button" className="btn btn-sm btn-quiet" disabled={Boolean(busy)} onClick={() => act('revoke')}>
              <ShieldOff size={16} aria-hidden="true" /> {busy === 'revoke' ? 'Cancelling…' : 'Cancel card'}
            </button>
          </div>
        )}
      </div>
      {qr && <img className="staff-card-qr" src={qr} alt={`QR code that opens ${card.verify_url}`} />}
    </article>
  )
}

/** Owners and super admins issue printed staff ID cards that anyone can check at /verify. */
export default function AdminStaffCardsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showOld, setShowOld] = useState(false)

  const load = useCallback(() => {
    apiRequest('/api/v1/admin/staff-cards').then(setData).catch((err) => setError(err.message))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const cards = (data?.cards || []).filter((c) => showOld || c.status !== 'revoked')
  const hidden = (data?.cards || []).length - cards.length

  return (
    <AdminShell eyebrow="Team" title="Staff ID cards"
      description="Each card has a QR code and a code. Anyone can scan it or type the code at ekimove.com.ng/verify to see that the holder is current EkiMove staff. Cancel a card the moment it’s lost or someone leaves.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        {data && (
          <p className="small muted">
            <BadgeCheck size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> {data.counts.valid} valid
            · {data.counts.expired} expired · {data.counts.revoked} cancelled
          </p>
        )}
        <IssueForm nextNumber={data?.next_number || 'EKM-001'} onIssued={load} />
        <div className="stack stack-sm">
          {cards.map((card) => <CardRow key={card.id} card={card} onChanged={load} />)}
          {data && !data.cards.length && <p className="muted">No cards yet. Issue the first one above.</p>}
          {hidden > 0 && (
            <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOld(true)}>
              Show {hidden} cancelled {hidden === 1 ? 'card' : 'cards'}
            </button>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
