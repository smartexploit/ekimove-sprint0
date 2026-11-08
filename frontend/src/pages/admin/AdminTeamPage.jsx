import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Copy, KeyRound, UserPlus } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { nameTyping } from '../../utils/inputRules.js'

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

function TemporaryPassword({ name, email, password, onDone }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="card stack stack-sm temp-pass" aria-live="polite">
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <KeyRound size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
        <h2 className="card-title">Temporary password for {name}</h2>
      </div>
      <p className="temp-pass-code">{password}</p>
      <p className="small">
        Give this to {name.split(' ')[0]} in person or on a phone call, not in a group chat. They open
        <strong> ekimove.com.ng/login</strong>, choose the <strong>Email</strong> tab, sign in with
        <strong> {email}</strong> and choose their own password straight away. It won’t be shown again.
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

function AddMember({ permissions, presets, domain, canAddSuper, onAdded }) {
  const [chosen, setChosen] = useState([])
  const [role, setRole] = useState('staff')
  const [confirmSuper, setConfirmSuper] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const superAdmin = role === 'super_admin'

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('full_name') || '').trim()
    const email = String(form.get('email') || '').trim().toLowerCase()
    if (name.length < 2) return setError('Enter their full name.')
    if (!email.endsWith(`@${domain}`)) return setError(`Use their work email ending in @${domain}.`)
    if (!superAdmin && !chosen.length) return setError('Choose at least one area they can use.')
    if (superAdmin && !confirmSuper) return setError('Tick the box to confirm full access.')
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/v1/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ full_name: name, email, role, permissions: superAdmin ? [] : chosen }),
      })
      setChosen([])
      setRole('staff')
      setConfirmSuper(false)
      event.target.reset()
      onAdded(result, email)
    } catch (err) {
      setError(err.message || 'Could not add them.')
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
      <label className="field" htmlFor="team-name">
        <span className="field-label">Full name</span>
        <input id="team-name" className="input" name="full_name" maxLength={80} autoComplete="off" required
          onInput={(e) => { const v = nameTyping(e.target.value); if (v !== e.target.value) e.target.value = v }} />
      </label>
      <label className="field" htmlFor="team-email">
        <span className="field-label">Work email (they sign in with this)</span>
        <input id="team-email" className="input" name="email" type="email" maxLength={254} autoComplete="off"
          required placeholder={`e.g. tolu@${domain}`} aria-describedby="team-email-hint" />
        <span className="field-hint" id="team-email-hint">
          Must end in @{domain}. Set it up in Cloudflare Email Routing first, so EkiMove emails like password resets reach them.
        </span>
      </label>
      <fieldset className="stack stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 8 }}>Access level</legend>
        <div className="chip-row">
          {[['staff', 'Staff: chosen areas'], ...(canAddSuper ? [['super_admin', 'Super-admin: full access']] : [])].map(([value, label]) => (
            <label key={value} className={`chip ${role === value ? 'is-active' : ''}`}>
              <input type="radio" className="sr-only" name="team-role" value={value} checked={role === value}
                onChange={() => { setRole(value); setError('') }} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {superAdmin ? (
        <div className="card card-outline stack stack-sm" style={{ padding: 14 }}>
          <p className="small">
            A super-admin can do almost everything you can: change fares and settings, approve payouts, suspend
            accounts and manage staff. They can’t change, suspend or remove your owner account, or add other
            super-admins. Only give this to your co-founder or someone you fully trust.
          </p>
          <label className="check-row" htmlFor="team-confirm-super">
            <input id="team-confirm-super" type="checkbox" checked={confirmSuper}
              onChange={(event) => { setConfirmSuper(event.target.checked); setError('') }} />
            <span>I understand this gives full access to EkiMove.</span>
          </label>
        </div>
      ) : (
        <>
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
        </>
      )}
      <Alert tone="error">{error}</Alert>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Adding…' : superAdmin ? 'Add as super-admin' : 'Add to the team'}
      </button>
    </form>
  )
}

function MemberCard({ member, permissions, isSelf, viewerIsOwner, onChanged, onPassword }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(member.permissions)
  const [confirm, setConfirm] = useState(null) // 'remove' | 'suspend'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const staff = member.role === 'staff'
  const first = member.full_name.split(' ')[0]
  const suspended = !member.is_active
  // The owner can't be changed by anyone; other super-admins only by the owner.
  const locked = member.is_owner || (!staff && !viewerIsOwner)

  async function run(path, options, after) {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest(path, options)
      after?.(result)
      setConfirm(null)
      onChanged()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const badge = member.is_owner
    ? ['badge-solid', 'Owner']
    : staff ? ['badge-gold', 'Staff'] : ['badge-green', 'Super-admin']

  return (
    <article className={`card stack stack-sm team-card ${suspended ? 'is-suspended' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title">{member.full_name}</h3>
          <p className="muted small">{[member.email, member.phone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {suspended && <span className="badge badge-red">Suspended</span>}
          <span className={`badge ${badge[0]}`}>{badge[1]}</span>
        </div>
      </div>
      <div className="chip-row">
        {staff
          ? member.permissions.map((p) => <span key={p} className="chip is-static">{SHORT[p] || p}</span>)
          : <span className="chip is-static">Everything</span>}
      </div>
      <p className="muted small">
        {suspended
          ? 'Can’t sign in until reactivated.'
          : member.must_change_password ? 'Hasn’t set their own password yet' : formatWhen(member.last_sign_in)}
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
      {confirm && (
        <div className="card card-outline stack stack-sm" style={{ padding: 12 }}>
          <p className="small">
            {confirm === 'suspend'
              ? `Suspend ${first}? They’re signed out everywhere and can’t sign in until you reactivate them. Nothing else changes.`
              : `Remove ${first}’s ${staff ? 'console' : 'super-admin'} access? They can no longer open the console, and any remembered phones are signed out. You can add them back later with the same work email.`}
          </p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-danger-outline" disabled={busy}
              onClick={() => run(`/api/v1/admin/staff/${member.id}/${confirm === 'suspend' ? 'suspend' : 'remove-access'}`,
                { method: 'POST' })}>
              {confirm === 'suspend' ? 'Suspend' : 'Remove access'}
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {isSelf && <p className="small muted">{member.is_owner ? 'This is you, the account owner. Nobody can change or remove this account.' : 'This is you.'}</p>}
      {!isSelf && locked && (
        <p className="small muted">
          {member.is_owner ? 'Account owner. Nobody can change, suspend or remove this account.' : 'Only the account owner can change a super-admin.'}
        </p>
      )}
      {!isSelf && !locked && !editing && !confirm && (
        <div className="row">
          {staff && !suspended && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Change access</button>}
          {!suspended && (
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => run(`/api/v1/admin/staff/${member.id}/reset-password`, { method: 'POST' },
                (result) => onPassword(member, result.temporary_password))}>
              New password
            </button>
          )}
          {suspended
            ? <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                onClick={() => run(`/api/v1/admin/staff/${member.id}/reactivate`, { method: 'POST' })}>Reactivate</button>
            : <button type="button" className="btn btn-sm" onClick={() => setConfirm('suspend')}>Suspend</button>}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirm('remove')}>Remove access</button>
        </div>
      )}
    </article>
  )
}

/** Super-admins add team members and choose what each can use. */
export default function AdminTeamPage() {
  const { user } = useOutletContext() || {}
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
          <TemporaryPassword name={secret.name} email={secret.email} password={secret.password}
            onDone={() => setSecret(null)} />
        )}
        {data && (
          <div className="team-layout">
            <AddMember permissions={data.permissions} presets={data.presets} domain={data.email_domain} canAddSuper={data.you_are_owner}
              onAdded={(result, email) => {
                setSecret({ name: result.member.full_name, email, password: result.temporary_password })
                load()
              }} />
            <section className="stack" aria-labelledby="team-list-title">
              <h2 id="team-list-title" className="section-title">Your team ({data.team.length})</h2>
              {data.team.map((member) => (
                <MemberCard key={`${member.id}-${member.permissions.join()}`} member={member} permissions={data.permissions}
                  isSelf={member.id === user?.id} viewerIsOwner={data.you_are_owner} onChanged={load}
                  onPassword={(m, password) => setSecret({ name: m.full_name, email: m.email, password })} />
              ))}
            </section>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
