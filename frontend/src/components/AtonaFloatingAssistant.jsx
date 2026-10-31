import { useState } from 'react'
import { apiRequest, getAccessToken } from '../services/authService.js'
import './AtonaFloatingAssistant.css'

export default function AtonaFloatingAssistant({ onApplyBooking }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hello! I'm Atona, your EkiMove travel assistant. Ask me about places and journeys around Ekiti in English or Nigerian Pidgin.",
    },
  ])
  const [pendingBooking, setPendingBooking] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendMessage(event) {
    event.preventDefault()
    const message = input.trim()

    if (message.length < 2 || busy) return

    const history = messages
      .slice(-12)
      .map((item) => `${item.role}: ${item.text}`)

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
          text: 'Please sign in before chatting with Atona.',
        },
      ])
      setBusy(false)
      return
    }

    try {
      const result = await apiRequest('/api/v1/atona/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          conversation_history: history,
        }),
      })

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          text: result.reply || 'I could not prepare a response. Please try again.',
        },
      ])
    } catch (err) {
      setError(err.message || 'Atona is temporarily unavailable.')
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
        text: 'Trip details applied to the booking form. Review the pickup, destination and available vehicle before submitting your request.',
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
              placeholder="Ask about a place, directions, or describe your trip..."
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
