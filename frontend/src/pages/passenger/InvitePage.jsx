import { useEffect, useState } from 'react'
import { Gift, Share2 } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import CopyButton from '../../components/ui/CopyButton.jsx'
import { getMyPromos } from '../../services/promoService.js'
import { formatNaira } from '../../utils/format.js'
import { formatPickupTime } from '../../utils/schedule.js'

/** A passenger's invite code and their own promo codes. */
export default function InvitePage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => getMyPromos())
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message || 'Could not load your invite code.'))
    return () => {
      active = false
    }
  }, [])

  const invite = data?.invite
  const link = invite ? `${window.location.origin}${invite.link_path}` : ''
  const message = invite
    ? `Join me on EkiMove for rides around Ekiti. Sign up with my code ${invite.code} and get ${formatNaira(invite.referral_new_user_amount, { decimals: 0 })} off your first ride: ${link}`
    : ''

  async function share() {
    setNotice('')
    try {
      if (navigator.share) {
        await navigator.share({ title: 'EkiMove', text: message })
      } else {
        await navigator.clipboard.writeText(message)
        setNotice('Invite message copied. Paste it in WhatsApp or a text.')
      }
    } catch {
      /* the person closed the share sheet */
    }
  }

  return (
    <AppShell title="Invite friends" description="Share EkiMove and you both save on rides.">
      <Alert tone="error">{error}</Alert>
      {!data && !error && <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> Loading…</div>}
      {data && (
        <div className="two-col">
          <section className="card card-lg stack" aria-labelledby="invite-title">
            <span className="instant-icon" aria-hidden="true"><Gift size={20} /></span>
            <h2 id="invite-title" className="section-title">Your invite code</h2>
            {invite.referral_enabled ? (
              <>
                <p className="muted small">
                  Friends who sign up with your code get {formatNaira(invite.referral_new_user_amount, { decimals: 0 })} off
                  their first ride. When they finish it, you get {formatNaira(invite.referral_reward_amount, { decimals: 0 })} off
                  your next ride.
                </p>
                <div className="temp-password">
                  <span className="invite-code">{invite.code}</span>
                  <CopyButton value={invite.code} label="Copy" />
                </div>
                <Alert tone="success">{notice}</Alert>
                <button type="button" className="btn btn-accent btn-lg" onClick={share}>
                  <Share2 size={18} aria-hidden="true" /> Share invite
                </button>
                <p className="muted small">
                  {invite.invited === 0
                    ? 'Nobody has joined with your code yet.'
                    : `${invite.invited} joined with your code · ${invite.completed_first_ride} finished their first ride.`}
                </p>
              </>
            ) : (
              <p className="muted small">Invites are paused right now. Check back soon.</p>
            )}
          </section>
          <section className="stack stack-sm" aria-labelledby="codes-title">
            <h2 id="codes-title" className="section-title" style={{ padding: '0 4px' }}>Your promo codes</h2>
            {data.codes.length === 0 ? (
              <p className="card muted small">No codes yet. Codes you get appear here and on the booking screen.</p>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {data.codes.map((code) => (
                  <li className="list-item" key={code.code}>
                    <div className="list-item-main">
                      <p className="list-item-title">{formatNaira(code.value, { decimals: 0 })} off · {code.code}</p>
                      <p className="list-item-meta">
                        {code.description}
                        {code.ends_at ? ` · use by ${formatPickupTime(code.ends_at)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
