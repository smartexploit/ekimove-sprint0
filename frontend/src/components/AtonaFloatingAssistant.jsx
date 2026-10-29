import { useState } from 'react'
import { apiRequest, getAccessToken } from '../services/authService.js'
import './AtonaFloatingAssistant.css'

export default function AtonaFloatingAssistant({ onApplyBooking }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello! I’m Atọ́nà, your EkiMove trip assistant. Describe where you want to travel, including nearby landmarks, and I’ll help prepare your booking.',
    },
  ])
  const [pendingBooking, setPendingBooking] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendMessage(event) {
    event.preventDefault()
    const message = input.trim()

    if (message.length < 3 || busy) return

    setMessages((current) => [...current, { role: 'user', text: message }])
    setInput('')
    setError('')
    setPendingBooking(null)
    setBusy(true)

    if (!getAccessToken()) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: 'Please sign in as a passenger at /login before I prepare your trip details.',
        },
      ])
      setBusy(false)
      return
    }

    try {
      const result = await apiRequest('/api/v1/atona/interpret', {
        method: 'POST',
        body: JSON.stringify({ message }),
      })

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: result.reply || 'I could not prepare those trip details. Please use the booking form.',
        },
      ])

      if (result.booking) {
        setPendingBooking(result.booking)
      }
    } catch (err) {
      setError(err.message || 'Atọ́nà is temporarily unavailable.')
    } finally {
      setBusy(false)
    }
  }

  function applyBooking() {
    if (!pendingBooking) return
    onApplyBooking(pendingBooking)
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: 'Trip details applied to the booking form. Review the zones, landmarks and vehicle before submitting your request.',
      },
    ])
    setPendingBooking(null)
    setOpen(false)
  }

  return (
    <div className="atona-widget">
      {open && (
        <section className="atona-panel" aria-label="Atọ́nà trip assistant">
          <header className="atona-header">
            <div>
              <strong>Atọ́nà</strong>
              <span>Your EkiMove trip assistant</span>
            </div>
            <button
              type="button"
              className="atona-close"
              onClick={() => setOpen(false)}
              aria-label="Close Atọ́nà"
            >
              ×
            </button>
          </header>

          <div className="atona-messages" aria-live="polite">
            {messages.map((item, index) => (
              <div
                className={`atona-message atona-message-${item.role}`}
                key={`${item.role}-${index}`}
              >
                {item.text}
              </div>
            ))}
            {busy && (
              <p className="atona-typing" role="status">
                Atọ́nà is preparing your trip details…
              </p>
            )}
          </div>

          {pendingBooking && (
            <div className="atona-booking-preview">
              <strong>Trip details ready</strong>
              <p>Pickup: {pendingBooking.origin_text}</p>
              <p>Destination: {pendingBooking.destination_text}</p>
              <p>Passenger count: {pendingBooking.passenger_count}</p>
              <p>
                Zones and vehicle availability will be checked by the booking form.
              </p>
              <button type="button" onClick={applyBooking}>
                Apply to booking form
              </button>
            </div>
          )}

          {error && (
            <p className="atona-error" role="alert">
              {error}
            </p>
          )}

          <form className="atona-compose" onSubmit={sendMessage}>
            <label className="atona-sr-only" htmlFor="atona-message-input">
              Describe your trip
            </label>
            <textarea
              id="atona-message-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Where are you travelling from and to?"
              rows={2}
              maxLength={1000}
              disabled={busy}
              required
            />
            <button type="submit" disabled={busy || input.trim().length < 3}>
              {busy ? 'Working…' : 'Send'}
            </button>
          </form>

          <p className="atona-disclaimer">
            Atọ́nà prepares trip details only. No ride is submitted and no fare
            is confirmed by this chat.
          </p>
        </section>
      )}

      <button
        type="button"
        className="atona-launcher"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Close Atọ́nà assistant' : 'Open Atọ́nà trip assistant'}
      >
        <span aria-hidden="true">✦</span>
        <span>{open ? 'Close Atọ́nà' : 'Ask Atọ́nà'}</span>
      </button>
    </div>
  )
}
