import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { formatDateTime } from '../../utils/format.js'

export function ChatMessages({ messages, mine }) {
  const end = useRef(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])
  return (
    <ol className="chat-log" aria-label="Messages">
      {messages.map((message) => {
        const isMine = mine(message)
        return (
          <li key={message.id} className={`chat-msg ${isMine ? 'is-mine' : ''}`}>
            <p className="chat-meta">
              {isMine ? 'You' : message.sender_name || 'Customer'} · {formatDateTime(message.created_at)}
            </p>
            <p className="chat-body">{message.body}</p>
          </li>
        )
      })}
      <li ref={end} aria-hidden="true" />
    </ol>
  )
}

export function ChatComposer({ onSend, disabled, placeholder = 'Type your message' }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    try {
      await onSend(body)
      setText('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="chat-compose" onSubmit={submit}>
      <label className="sr-only" htmlFor="chat-input">Message</label>
      <textarea id="chat-input" className="textarea" rows={2} maxLength={2000} value={text}
        onChange={(event) => setText(event.target.value)} placeholder={placeholder} disabled={disabled} />
      <button type="submit" className="btn btn-primary" disabled={disabled || busy || !text.trim()}
        aria-label="Send message">
        <Send size={18} aria-hidden="true" /> Send
      </button>
    </form>
  )
}
