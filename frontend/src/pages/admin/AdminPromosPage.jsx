import { useCallback, useEffect, useState } from 'react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import Select from '../../components/ui/Select.jsx'
import { saveAdminSettings } from '../../services/accountService.js'
import { createPromo, listAdminPromos, setPromoActive } from '../../services/promoService.js'
import { formatNaira, formatShortDate } from '../../utils/format.js'

const EMPTY = {
  code: '', description: '', kind: 'amount', value: '', max_discount: '', min_fare: '', ends_at: '',
  max_uses: '', per_user_limit: '1', first_ride_only: false,
}

function describe(code) {
  const off = code.kind === 'percent' ? `${Number(code.value)}% off` : `${formatNaira(code.value, { decimals: 0 })} off`
  const parts = [off]
  if (code.max_discount) parts.push(`up to ${formatNaira(code.max_discount, { decimals: 0 })}`)
  if (code.min_fare) parts.push(`fares from ${formatNaira(code.min_fare, { decimals: 0 })}`)
  if (code.first_ride_only) parts.push('first ride only')
  return parts.join(' · ')
}

function InviteSettings({ rules, onSaved }) {
  const [form, setForm] = useState({
    enabled: rules.referral_enabled,
    newUser: String(rules.referral_new_user_amount),
    reward: String(rules.referral_reward_amount),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveAdminSettings({
        referral_enabled: form.enabled,
        referral_new_user_amount: Number(form.newUser || 0),
        referral_reward_amount: Number(form.reward || 0),
      })
      setNotice('Saved. New sign-ups use these amounts.')
      onSaved()
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const digits = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value.replace(/\D/g, '').slice(0, 5) }))
  return (
    <form className="card stack" onSubmit={save} aria-labelledby="invite-settings-title">
      <h2 id="invite-settings-title" className="section-title">Invites</h2>
      <p className="muted small">
        Every passenger has an invite code. The discount comes out of EkiMove’s commission; drivers still earn on the full fare.
      </p>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <label className="check-row">
        <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))} />
        Invites are on
      </label>
      <div className="date-row">
        <label className="field">
          <span className="field-label">New passenger gets (₦ off first ride)</span>
          <input className="input" inputMode="numeric" value={form.newUser} onChange={digits('newUser')} />
        </label>
        <label className="field">
          <span className="field-label">Inviter gets (₦ off next ride)</span>
          <input className="input" inputMode="numeric" value={form.reward} onChange={digits('reward')} />
        </label>
      </div>
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save invites'}</button>
      </div>
    </form>
  )
}

function NewCode({ onCreated }) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const optional = (value) => (value === '' ? null : value)
    try {
      await createPromo({
        code: form.code.trim(),
        description: optional(form.description.trim()),
        kind: form.kind,
        value: form.value,
        max_discount: form.kind === 'percent' ? optional(form.max_discount) : null,
        min_fare: optional(form.min_fare),
        ends_at: form.ends_at ? `${form.ends_at}T23:59:59+01:00` : null,
        max_uses: optional(form.max_uses),
        per_user_limit: Number(form.per_user_limit || 1),
        first_ride_only: form.first_ride_only,
      })
      setForm(EMPTY)
      onCreated()
    } catch (err) {
      setError(err.message || 'Could not create the code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="new-code-title">
      <h2 id="new-code-title" className="section-title">New promo code</h2>
      <Alert tone="error">{error}</Alert>
      <div className="date-row">
        <label className="field">
          <span className="field-label">Code</span>
          <input className="input" required minLength={3} maxLength={32} autoCapitalize="characters" placeholder="e.g. EKSU500"
            value={form.code} onChange={(event) => setForm((f) => ({ ...f, code: event.target.value.toUpperCase() }))} />
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <Select value={form.kind} onChange={set('kind')}>
            <option value="amount">Naira off</option>
            <option value="percent">Percent off</option>
          </Select>
        </label>
        <label className="field">
          <span className="field-label">{form.kind === 'percent' ? 'Percent' : 'Amount (₦)'}</span>
          <input className="input" required inputMode="decimal" value={form.value} onChange={set('value')} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">What it’s for (optional)</span>
        <input className="input" maxLength={160} placeholder="e.g. EKSU resumption week" value={form.description}
          onChange={set('description')} />
      </label>
      <div className="date-row">
        {form.kind === 'percent' && (
          <label className="field">
            <span className="field-label">Most off (₦, optional)</span>
            <input className="input" inputMode="numeric" value={form.max_discount} onChange={set('max_discount')} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Minimum fare (₦, optional)</span>
          <input className="input" inputMode="numeric" value={form.min_fare} onChange={set('min_fare')} />
        </label>
        <label className="field">
          <span className="field-label">Last day (optional)</span>
          <input className="input" type="date" value={form.ends_at} onChange={set('ends_at')} />
        </label>
      </div>
      <div className="date-row">
        <label className="field">
          <span className="field-label">Total uses (optional)</span>
          <input className="input" inputMode="numeric" value={form.max_uses} onChange={set('max_uses')} />
        </label>
        <label className="field">
          <span className="field-label">Uses per person</span>
          <input className="input" inputMode="numeric" value={form.per_user_limit} onChange={set('per_user_limit')} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={form.first_ride_only} onChange={set('first_ride_only')} />
        Only for a passenger’s first ride
      </label>
      <p className="muted small">Every ride still costs at least ₦100 after a discount.</p>
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create code'}</button>
      </div>
    </form>
  )
}

export default function AdminPromosPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => listAdminPromos().then(setData).catch((err) => setError(err.message)), [])
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load())
    return () => {
      active = false
    }
  }, [load])

  async function toggle(code) {
    setBusy(code.id)
    try {
      await setPromoActive(code.id, !code.is_active)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminShell title="Promos & invites" description="Discount codes and the invite programme.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        {data && (
          <>
            <div className="stat-grid">
              <div className="stat"><p className="stat-label">Invited sign-ups</p><p className="stat-value">{data.invites.referred_people}</p></div>
              <div className="stat"><p className="stat-label">Invite codes used</p><p className="stat-value">{data.invites.used}</p></div>
              <div className="stat"><p className="stat-label">Invite discounts</p>
                <p className="stat-value">{formatNaira(data.invites.total_discount, { decimals: 0 })}</p></div>
            </div>
            <div className="two-col">
              <div className="stack">
                <NewCode onCreated={load} />
                <InviteSettings key={JSON.stringify(data.rules)} rules={data.rules} onSaved={load} />
              </div>
              <section className="stack stack-sm" aria-labelledby="codes-title">
                <h2 id="codes-title" className="section-title" style={{ padding: '0 4px' }}>Codes</h2>
                {data.codes.length === 0 ? (
                  <p className="card muted small">No promo codes yet.</p>
                ) : (
                  <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {data.codes.map((code) => (
                      <li className="list-item" key={code.id}>
                        <div className="list-item-main">
                          <p className="list-item-title">
                            {code.code}{' '}
                            <span className={`badge ${code.is_active ? 'badge-green' : 'badge-neutral'}`}>
                              {code.is_active ? 'Active' : 'Paused'}
                            </span>
                          </p>
                          <p className="list-item-meta">{describe(code)}</p>
                          <p className="list-item-meta">
                            Used {code.uses}{code.max_uses ? ` of ${code.max_uses}` : ''} ·{' '}
                            {formatNaira(code.total_discount, { decimals: 0 })} given
                            {code.ends_at ? ` · ends ${formatShortDate(code.ends_at)}` : ''}
                            {code.description ? ` · ${code.description}` : ''}
                          </p>
                        </div>
                        <button type="button" className="btn btn-sm" disabled={busy === code.id} onClick={() => toggle(code)}>
                          {code.is_active ? 'Pause' : 'Resume'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  )
}
