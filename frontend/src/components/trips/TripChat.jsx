import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { getTripMessages, sendTripMessage } from '../../services/promoService.js'

const POLL_MS = 5000
const QUICK = {
  passenger: ['I’m at the pickup point', 'Coming out now', 'Please wait 2 minutes', 'Where are you?'],
  driver: ['I’ve arrived', 'I’m 2 minutes away', 'I’m by the gate', 'Please come out'],
}

function timeOf(value) {
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' })
    .format(new Date(value))
}

/** In-app messages between a passenger and their driver during a trip. */
export default function TripChat({ rideId, who, unread = 0, other = who === 'driver' ? 'passenger' : 'driver' }) {
  const [open, setOpen] = useState(false)
  const [chat, setChat] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    let active = true
    const load = () => getTripMessages(rideId).then((data) => active && setChat(data)).catch(() => {})
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [open, rideId])

  const count = chat?.messages.length || 0
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [count])

  async function send(body) {
    const clean = body.trim()
    if (!clean) return
    setBusy(true)
    setError('')
    try {
      setChat(await sendTripMessage(rideId, clean))
      setText('')
    } catch (err) {
      setError(err.message || 'Could not send.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <MessageCircle size={18} aria-hidden="true" /> Message {other}
        {unread > 0 && <span className="nav-count" aria-label={`${unread} new`}>{unread}</span>}
      </button>
    )
  }

  return (
    <section className="trip-chat" aria-label={`Messages with your ${other}`}>
      <div className="row row-between">
        <h3 className="section-title" style={{ fontSize: 16 }}>Messages with your {other}</h3>
        <button type="button" className="link-button link-tap small" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="trip-chat-log" ref={logRef} aria-live="polite">
        {!chat ? (
          <p className="muted small">Loading…</p>
        ) : chat.messages.length === 0 ? (
          <p className="muted small">No messages yet. Your number stays private.</p>
        ) : chat.messages.map((message) => (
          <p key={message.id} className={`trip-bubble ${message.mine ? 'is-mine' : ''}`}>
            {message.body}
            <time dateTime={message.created_at}>{message.mine ? 'You' : other === 'driver' ? 'Driver' : 'Passenger'} · {timeOf(message.created_at)}</time>
          </p>
        ))}
      </div>
      {chat && !chat.open ? (
        <p className="muted small">This trip has ended, so the chat is closed.</p>
      ) : (
        <>
          <div className="quick-replies" role="group" aria-label="Quick messages">
            {QUICK[who].map((line) => (
              <button key={line} type="button" className="chip chip-sm" disabled={busy} onClick={() => send(line)}>{line}</button>
            ))}
          </div>
          <form className="row" style={{ gap: 8, flexWrap: 'nowrap' }} onSubmit={(event) => {
            event.preventDefault()
            send(text)
          }}>
            <label className="sr-only" htmlFor={`trip-chat-${rideId}`}>Message</label>
            <input id={`trip-chat-${rideId}`} className="input input-sm" maxLength={500} value={text}
              placeholder="Type a message" onChange={(event) => setText(event.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} aria-label="Send">
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </>
      )}
      {error && <p className="field-hint field-hint-error" role="alert">{error}</p>}
    </section>
  )
}
