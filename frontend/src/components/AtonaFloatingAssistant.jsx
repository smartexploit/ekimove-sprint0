import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { LogoMark } from './brand/Logo.jsx'
import FormattedText from './atona/FormattedText.jsx'
import useAtonaStatus from '../hooks/useAtonaStatus.js'
import { apiRequest, getAccessToken, getStoredUser } from '../services/authService.js'
import { firstName, formatNaira } from '../utils/format.js'
import { vehicleLabel } from '../utils/vehicles.js'
import './AtonaFloatingAssistant.css'

const MAX_HISTORY = 12

function viewerProfile() {
  const signedIn = Boolean(getAccessToken())
  const user = signedIn ? getStoredUser() : null
  return { signedIn, role: user?.role || (signedIn ? 'passenger' : 'guest'), name: firstName(user?.full_name) }
}

function welcomeFor({ signedIn, role, name }) {
  const hello = name ? `Hello ${name}! ` : 'Hello! '
  if (!signedIn) {
    return `${hello}I'm Atọ́nà, EkiMove's guide. Ask me about fares, places we cover, how payment works or driving with us, in English or Pidgin.`
  }
  if (role === 'driver') {
    return `${hello}I'm Atọ́nà. I can check your trips and driver status, or answer questions about how EkiMove works.`
  }
  return `${hello}I'm Atọ́nà. I can check a fare, find your ride and its driver, or explain how to pay. Wetin you need?`
}

function suggestionsFor({ signedIn, role }) {
  if (!signedIn) {
    return ['How does EkiMove work?', 'Which places do you cover?', 'How do I pay?', 'How can I drive with EkiMove?']
  }
  if (role === 'driver') {
    return ['Show my trips', 'Am I approved to drive?', 'How do I go online?']
  }
  return ["Where's my ride?", 'Check a fare', 'How do I pay?', 'Which places do you cover?']
}

function TripCard({ draft, onUse }) {
  const chosen = draft.fares.find((fare) => fare.vehicle_type === draft.vehicle_type)

  return (
    <div className="atona-trip">
      <p className="atona-trip-title">Trip ready</p>
      <p className="atona-trip-route">
        {draft.origin_name} → {draft.destination_name}
      </p>
      <ul className="atona-trip-fares">
        {draft.fares.map((fare) => (
          <li key={fare.vehicle_type} className={fare === chosen ? 'is-chosen' : ''}>
            <span>{vehicleLabel(fare.vehicle_type)}</span>
            <strong>{formatNaira(fare.fare_naira, { decimals: 0 })}</strong>
          </li>
        ))}
      </ul>
      <p className="atona-trip-note">
        {draft.passenger_count} {draft.passenger_count === 1 ? 'passenger' : 'passengers'} ·
        nothing is booked until you confirm.
      </p>
      <button type="button" className="atona-btn atona-btn-primary" onClick={() => onUse(draft)}>
        Continue to booking <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Atọ́nà chat for everyone. Account answers (rides, driver status) ask
 * guests to sign in. A quoted trip can be opened straight into booking:
 * `onApplyBooking` fills the current booking form; otherwise it navigates
 * to Book a ride with the trip prefilled.
 */
export default function AtonaFloatingAssistant({ onApplyBooking }) {
  const available = useAtonaStatus()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastFailed, setLastFailed] = useState('')
  const launcherRef = useRef(null)
  const inputRef = useRef(null)
  const endRef = useRef(null)
  const wasOpenRef = useRef(false)
  const panelId = useId()
  const viewer = viewerProfile()

  // Focus the message box on open; give focus back to the launcher on close.
  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) launcherRef.current?.focus()
      wasOpenRef.current = false
      return undefined
    }
    wasOpenRef.current = true
    inputRef.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy, open])

  if (!available) return null

  const returnState = { from: `${location.pathname}${location.search}` }

  async function send(text) {
    const message = String(text || '').trim()
    if (message.length < 2 || busy) return

    const history = messages
      .filter((item) => item.text)
      .slice(-MAX_HISTORY)
      .map((item) => ({ role: item.role, content: item.text.slice(0, 2000) }))

    setMessages((current) => [...current, { role: 'user', text: message }])
    setInput('')
    setError('')
    setLastFailed('')
    setBusy(true)

    try {
      const result = await apiRequest('/api/v1/atona/chat', {
        method: 'POST',
        body: JSON.stringify({ message, conversation_history: history }),
      })
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: result.reply || "Sorry, I couldn't prepare an answer. Please try again.",
          draft: result.booking_draft?.fares?.length ? result.booking_draft : null,
          needsSignIn: Boolean(result.needs_sign_in) && !result.signed_in,
        },
      ])
    } catch (err) {
      setError(err.message || 'Atọ́nà is unavailable right now.')
      setLastFailed(message)
      // Take the unanswered message back out so a retry doesn't duplicate it.
      setMessages((current) => current.slice(0, -1))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function applyDraft(draft) {
    if (onApplyBooking) {
      onApplyBooking(draft)
    } else {
      const params = new URLSearchParams({
        area: String(draft.service_area_id),
        from: String(draft.origin_place_id),
        to: String(draft.destination_place_id),
        passengers: String(draft.passenger_count || 1),
      })
      if (draft.vehicle_type) params.set('vehicle', draft.vehicle_type)
      navigate(`/book-ride?${params.toString()}`)
    }
    setOpen(false)
  }

  function onSubmit(event) {
    event.preventDefault()
    send(input)
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(input)
    }
  }

  function close() {
    setOpen(false)
  }

  return (
    <div className="atona-widget">
      {open && (
        <section className="atona-panel" id={panelId} aria-label="Chat with Atọ́nà">
          <header className="atona-header">
            <span className="atona-avatar" aria-hidden="true">
              <LogoMark size={26} reversed />
            </span>
            <div className="atona-header-text">
              <strong>Atọ́nà</strong>
              <span>Your EkiMove guide</span>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className="atona-icon-btn"
                onClick={() => {
                  setMessages([])
                  setError('')
                }}
                aria-label="Start a new chat"
                disabled={busy}
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="atona-icon-btn" onClick={close} aria-label="Close Atọ́nà">
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="atona-messages" aria-live="polite" aria-relevant="additions">
            <div className="atona-message atona-message-assistant">
              <FormattedText text={welcomeFor(viewer)} />
            </div>

            {messages.length === 0 && (
              <div className="atona-chips" role="group" aria-label="Suggested questions">
                {suggestionsFor(viewer).map((suggestion) => (
                  <button key={suggestion} type="button" className="atona-chip" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {messages.map((item, index) => (
              <div key={index} className={`atona-message atona-message-${item.role}`}>
                {item.role === 'assistant' ? <FormattedText text={item.text} /> : <p>{item.text}</p>}
                {item.draft && <TripCard draft={item.draft} onUse={applyDraft} />}
                {item.needsSignIn && (
                  <div className="atona-signin">
                    <Link className="atona-btn atona-btn-primary" to="/login" state={returnState}>
                      Sign in
                    </Link>
                    <Link className="atona-btn" to="/register" state={returnState}>
                      Create account
                    </Link>
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <p className="atona-typing" role="status">
                <span className="atona-dots" aria-hidden="true"><span /><span /><span /></span>
                Atọ́nà is thinking…
              </p>
            )}

            {error && (
              <div className="atona-error" role="alert">
                <p>{error}</p>
                {lastFailed && (
                  <button type="button" className="atona-btn" onClick={() => send(lastFailed)} disabled={busy}>
                    Try again
                  </button>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="atona-compose" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor={`${panelId}-input`}>
              Message Atọ́nà
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about a fare, your ride, or anything EkiMove…"
              rows={1}
              maxLength={1000}
              disabled={busy}
            />
            <button
              type="submit"
              className="atona-send"
              disabled={busy || input.trim().length < 2}
              aria-label="Send message"
            >
              <Send size={18} aria-hidden="true" />
            </button>
          </form>

          <p className="atona-disclaimer">
            Atọ́nà can make mistakes. It never books rides or takes payments for you.
          </p>
        </section>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="atona-launcher"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls={panelId}
        >
          <Sparkles size={18} aria-hidden="true" />
          <span>Ask Atọ́nà</span>
        </button>
      )}
    </div>
  )
}
