import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Plus } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import SupportContacts from '../../components/SupportContacts.jsx'
import { ChatComposer, ChatMessages } from '../../components/support/Chat.jsx'
import {
  getMyThread,
  listMyThreads,
  sendMyMessage,
  startThread,
} from '../../services/accountService.js'
import { formatDateTime } from '../../utils/format.js'

const POLL_MS = 5000

function NewConversation({ onCreated, onCancel }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await startThread(subject.trim(), message.trim()))
    } catch (err) {
      setError(err.message || 'Could not send your message.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="new-chat-title">
      <h2 id="new-chat-title" className="section-title">Message EkiMove support</h2>
      <Alert tone="error">{error}</Alert>
      <label className="field">
        <span className="field-label">What is it about?</span>
        <input className="input" minLength={3} maxLength={160} required value={subject}
          onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Payment for ride #12" />
      </label>
      <label className="field">
        <span className="field-label">Your message</span>
        <textarea className="textarea" rows={4} maxLength={2000} required value={message}
          onChange={(event) => setMessage(event.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function SupportPage() {
  const [params, setParams] = useSearchParams()
  const threadId = params.get('thread')
  const composing = params.get('new') === '1'
  const [threads, setThreads] = useState({ loaded: false, list: [] })
  const [thread, setThread] = useState(null)
  const [error, setError] = useState('')

  const loadThreads = useCallback(() => listMyThreads()
    .then((list) => setThreads({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch((err) => {
      setThreads((current) => ({ ...current, loaded: true }))
      setError(err.message || 'Could not load your conversations.')
    }), [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && loadThreads())
    return () => {
      active = false
    }
  }, [loadThreads])

  useEffect(() => {
    if (!threadId) return undefined
    let active = true
    const load = () => getMyThread(threadId)
      .then((data) => active && setThread(data))
      .catch((err) => active && setError(err.message || 'Could not open this conversation.'))
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [threadId])

  const open = (id) => setParams(id ? { thread: String(id) } : {})
  const current = thread && String(thread.id) === threadId ? thread : null

  async function send(body) {
    const updated = await sendMyMessage(threadId, body)
    setThread(updated)
    loadThreads()
  }

  return (
    <AppShell
      title="Support"
      description="Chat with the EkiMove team. We usually reply within working hours."
      actions={!threadId && !composing && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setParams({ new: '1' })}>
          <Plus size={16} aria-hidden="true" /> New message
        </button>
      )}
    >
      <Alert tone="error">{error}</Alert>

      {composing ? (
        <NewConversation
          onCreated={(created) => {
            setThread(created)
            loadThreads()
            open(created.id)
          }}
          onCancel={() => setParams({})}
        />
      ) : threadId ? (
        <section className="card chat" aria-label="Conversation">
          <div className="chat-head">
            <button type="button" className="icon-btn" onClick={() => open(null)} aria-label="Back to conversations">
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <div style={{ minWidth: 0 }}>
              <h2 className="section-title chat-title">{current?.subject || 'Conversation'}</h2>
              {current?.status === 'closed' && (
                <p className="muted small">Marked as resolved. Write again if you still need help.</p>
              )}
            </div>
          </div>
          {current?.ride_request?.service_type === 'haulage' && (
            <p className="small chat-context">
              Load booking #{current.ride_request.id} · {current.ride_request.route}.{' '}
              <Link className="text-link" to="/move-a-load">See the quote</Link>
            </p>
          )}
          {current ? (
            <ChatMessages messages={current.messages} mine={(message) => !message.from_staff} />
          ) : (
            <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> Loading…</div>
          )}
          <ChatComposer onSend={send} disabled={!current} />
        </section>
      ) : (
        <div className="two-col">
          <section className="stack stack-sm" aria-labelledby="threads-title">
            <h2 id="threads-title" className="section-title" style={{ padding: '0 4px' }}>Your conversations</h2>
            {threads.loaded && threads.list.length === 0 ? (
              <div className="card empty">
                <span className="empty-icon"><MessageCircle size={28} aria-hidden="true" /></span>
                <h2>No messages yet</h2>
                <p className="muted">Questions about a ride, a payment or your account? Send us a message.</p>
                <button type="button" className="btn btn-primary" onClick={() => setParams({ new: '1' })}>
                  Message support
                </button>
              </div>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {threads.list.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="list-item list-button" onClick={() => open(item.id)}>
                      <span className="list-item-main">
                        <span className="list-item-title">
                          {item.subject}
                          {item.unread > 0 && <span className="nav-dot" aria-label="New reply" />}
                        </span>
                        <span className="list-item-meta">
                          {item.last_from_staff ? 'EkiMove: ' : 'You: '}{item.last_message}
                        </span>
                      </span>
                      <span className="muted small" style={{ flexShrink: 0 }}>
                        {item.status === 'closed' ? 'Resolved' : formatDateTime(item.last_message_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <aside className="card stack stack-sm">
            <h2 className="section-title">Other ways to reach us</h2>
            <SupportContacts className="stack stack-sm small" linkClassName="contact-link text-link"
              fallback={<p className="muted small">Chat here is the quickest way to reach us.</p>} />
            <p className="muted small">In an emergency, call 112. On a live ride, use SOS in My rides.</p>
          </aside>
        </div>
      )}
    </AppShell>
  )
}
