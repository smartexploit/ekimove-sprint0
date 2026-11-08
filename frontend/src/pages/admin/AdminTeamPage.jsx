import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, UserPlus } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { nameTyping, nigerianMobile, phoneTyping } from '../../utils/inputRules.js'

const PRESET_LABELS = {
  dispatcher: 'Dispatcher',
  driver_reviewer: 'Driver reviewer',
  support_agent: 'Support agent',
  finance: 'Finance',
  website_editor: 'Website editor',
}
const SHORT = { dispatch: 'Dispatch', drivers: 'Driver reviews', support: 'Support', finance: 'Finance', website: 'Website' }

function formatWhen(value) {
  if (!value) return 'Never signed in'
  return `Last signed in ${new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
}

function PermissionBoxes({ permissions, value, onChange, idPrefix }) {
  return (
    <div className="stack stack-sm">
      {permissions.map(({ key, label }) => {
        const [title, rest] = label.split(': ')
        return (
          <label className="check-row" key={key} htmlFor={`${idPrefix}-${key}`}>
            <input id={`${idPrefix}-${key}`} type="checkbox" checked={value.includes(key)}
              onChange={(event) => onChange(event.target.checked ? [...value, key] : value.filter((p) => p !== key))} />
            <span><strong>{title}</strong>{rest ? <span className="muted">: {rest}</span> : null}</span>
          </label>
        )
      })}
    </div>
  )
}

function TemporaryPassword({ name, phone, password, onDone }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="card stack stack-sm temp-pass" aria-live="polite">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <KeyRound size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
        <h2 className="card-title">Temporary password for {name}</h2>
      </div>
      <p className="temp-pass-code">{password}</p>
      <p className="small">
        Give this to {name.split(' ')[0]} in person or on a phone call, not in a group chat. They sign in at
        <strong> ekimove.com.ng/login</strong> with <strong>{phone}</strong> and choose their own password straight away.
        It won’t be shown again.
      </p>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => {
          navigator.clipboard?.writeText(password).then(() => setCopied(true), () => {})
        }}>
          <Copy size={16} aria-hidden="true" /> {copied ? 'Copied' : 'Copy password'}
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>Done</button>
      </div>
    </section>
  )
}

function AddMember({ permissions, presets, onAdded }) {
  const [chosen, setChosen] = useState([])
  const [error, setError] = useState('')
  const [existing, setExisting] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event, useExisting = false) {
    event?.preventDefault?.()
    const form = new FormData(document.getElementById('team-add-form'))
    const name = String(form.get('full_name') || '').trim()
    const phone = nigerianMobile(form.get('phone'))
    if (name.length < 2) return setError('Enter their full name.')
    if (!phone) return setError('Enter a Nigerian mobile number, like 0803 123 4567.')
    if (!chosen.length) return setError('Choose at least one area they can use.')
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          full_name: name, phone, email: String(form.get('email') || '').trim() || null,
          permissions: chosen, use_existing_account: useExisting,
        }),
      })
      setExisting('')
      setChosen([])
      document.getElementById('team-add-form').reset()
      onAdded(result, phone)
    } catch (err) {
      if (err.code === 'existing_account') setExisting(err.message)
      else setError(err.message || 'Could not add them.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form id="team-add-form" className="card stack" onSubmit={submit} aria-labelledby="team-add-title">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <UserPlus size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
        <h2 id="team-add-title" className="card-title">Add a team member</h2>
      </div>
      <div className="form-grid">
        <label className="field" htmlFor="team-name">
          <span className="field-label">Full name</span>
          <input id="team-name" className="input" name="full_name" maxLength={80} autoComplete="off" required
            onInput={(e) => { const v = nameTyping(e.target.value); if (v !== e.target.value) e.target.value = v }} />
        </label>
        <label className="field" htmlFor="team-phone">
          <span className="field-label">Phone number (they sign in with this)</span>
          <input id="team-phone" className="input" name="phone" type="tel" inputMode="tel" maxLength={18} required
            placeholder="e.g. 0803 123 4567"
            onInput={(e) => { const v = phoneTyping(e.target.value); if (v !== e.target.value) e.target.value = v }} />
        </label>
      </div>
      <label className="field" htmlFor="team-email">
        <span className="field-label">Email (optional)</span>
        <input id="team-email" className="input" name="email" type="email" maxLength={254} autoComplete="off" />
      </label>
      <div className="stack stack-sm">
        <span className="field-label">Start from a role</span>
        <div className="chip-row">
          {Object.entries(presets).map(([key, perms]) => {
            const active = perms.length === chosen.length && perms.every((p) => chosen.includes(p))
            return (
              <button type="button" key={key} className={`chip ${active ? 'is-active' : ''}`} aria-pressed={active}
                onClick={() => setChosen(perms)}>
                {PRESET_LABELS[key] || key}
              </button>
            )
          })}
        </div>
      </div>
      <fieldset className="stack stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 8 }}>What they can use</legend>
        <PermissionBoxes permissions={permissions} value={chosen} onChange={setChosen} idPrefix="add" />
      </fieldset>
      <p className="muted small">
        Only super-admins can change fares, places and zones, app settings, suspend or remove accounts, or manage the team.
      </p>
      <Alert tone="error">{error}</Alert>
      {existing && (
        <div className="card card-outline stack stack-sm" style={{ padding: 14 }}>
          <p className="small">{existing}</p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => submit(null, true)}>
              Make it a staff account
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setExisting('')}>Use another number</button>
          </div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Adding…' : 'Add to the team'}
      </button>
    </form>
  )
}

function MemberCard({ member, permissions, onChanged, onPassword }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(member.permissions)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const staff = member.role === 'staff'

  async function run(path, options, after) {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest(path, options)
      after?.(result)
      onChanged()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card stack stack-sm team-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title">{member.full_name}</h3>
          <p className="muted small">{[member.phone, member.email].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`badge ${staff ? 'badge-gold' : 'badge-green'}`}>{staff ? 'Staff' : 'Super-admin'}</span>
      </div>
      <div className="chip-row">
        {staff
          ? member.permissions.map((p) => <span key={p} className="chip is-static">{SHORT[p] || p}</span>)
          : <span className="chip is-static">Everything</span>}
      </div>
      <p className="muted small">
        {member.must_change_password ? 'Hasn’t set their own password yet' : formatWhen(member.last_sign_in)}
      </p>
      <Alert tone="error">{error}</Alert>
      {staff && editing && (
        <div className="stack stack-sm">
          <PermissionBoxes permissions={permissions} value={draft} onChange={setDraft} idPrefix={`m${member.id}`} />
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !draft.length}
              onClick={() => run(`/api/v1/admin/staff/${member.id}`, { method: 'PATCH', body: JSON.stringify({ permissions: draft }) },
                () => setEditing(false))}>
              Save access
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => { setEditing(false); setDraft(member.permissions) }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {staff && confirmRemove && (
        <div className="card card-outline stack stack-sm" style={{ padding: 12 }}>
          <p className="small">
            Remove {member.full_name.split(' ')[0]}’s console access? Their account becomes an ordinary passenger account
            and any remembered phones are signed out.
          </p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-danger-outline" disabled={busy}
              onClick={() => run(`/api/v1/admin/staff/${member.id}/remove-access`, { method: 'POST' })}>
              Remove access
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmRemove(false)}>Keep</button>
          </div>
        </div>
      )}
      {staff && !editing && !confirmRemove && (
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Change access</button>
          <button type="button" className="btn btn-sm" disabled={busy}
            onClick={() => run(`/api/v1/admin/staff/${member.id}/reset-password`, { method: 'POST' },
              (result) => onPassword(member, result.temporary_password))}>
            New password
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmRemove(true)}>Remove access</button>
        </div>
      )}
    </article>
  )
}

/** Super-admins add team members and choose what each can use. */
export default function AdminTeamPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [secret, setSecret] = useState(null)

  const load = useCallback(() => apiRequest('/api/v1/admin/staff')
    .then((result) => { setData(result); setError('') })
    .catch((err) => setError(err.message || 'Could not load the team.')), [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <AdminShell eyebrow="Team" title="Team & access"
      description="Give each team member their own sign-in and only the parts of the console their job needs.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        {secret && (
          <TemporaryPassword name={secret.name} phone={secret.phone} password={secret.password}
            onDone={() => setSecret(null)} />
        )}
        {data && (
          <div className="team-layout">
            <AddMember permissions={data.permissions} presets={data.presets}
              onAdded={(result, phone) => {
                if (result.temporary_password) {
                  setSecret({ name: result.member.full_name, phone, password: result.temporary_password })
                }
                load()
              }} />
            <section className="stack" aria-labelledby="team-list-title">
              <h2 id="team-list-title" className="section-title">Your team ({data.team.length})</h2>
              {data.team.map((member) => (
                <MemberCard key={`${member.id}-${member.permissions.join()}`} member={member} permissions={data.permissions}
                  onChanged={load}
                  onPassword={(m, password) => setSecret({ name: m.full_name, phone: m.phone, password })} />
              ))}
            </section>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
