import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, MessageCircle, RotateCcw } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { ChatComposer, ChatMessages } from '../../components/support/Chat.jsx'
import {
  getStaffThread,
  listStaffThreads,
  sendStaffMessage,
  setThreadStatus,
} from '../../services/accountService.js'
import { formatDateTime } from '../../utils/format.js'

const POLL_MS = 5000

export default function AdminSupportPage() {
  const [params, setParams] = useSearchParams()
  const threadId = params.get('thread')
  const filter = params.get('status') === 'closed' ? 'closed' : 'open'
  const [threads, setThreads] = useState({ loaded: false, list: [] })
  const [thread, setThread] = useState(null)
  const [error, setError] = useState('')

  const loadThreads = useCallback(() => listStaffThreads(filter)
    .then((list) => setThreads({ loaded: true, list: Array.isArray(list) ? list : [] }))
    .catch((err) => setError(err.message || 'Could not load conversations.')), [filter])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && loadThreads())
    const timer = window.setInterval(loadThreads, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loadThreads])

  useEffect(() => {
    if (!threadId) return undefined
    let active = true
    const load = () => getStaffThread(threadId)
      .then((data) => active && setThread(data))
      .catch((err) => active && setError(err.message || 'Could not open this conversation.'))
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [threadId])

  const current = thread && String(thread.id) === threadId ? thread : null
  const open = (id) => setParams({ ...(filter === 'closed' ? { status: 'closed' } : {}), ...(id ? { thread: String(id) } : {}) })

  async function send(body) {
    setThread(await sendStaffMessage(threadId, body))
    loadThreads()
  }

  async function toggleStatus() {
    setThread(await setThreadStatus(threadId, current.status === 'open' ? 'closed' : 'open'))
    loadThreads()
  }

  const request = current?.ride_request

  return (
    <AdminShell title="Support" description="Chats from passengers and drivers. Waiting replies are listed first.">
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <div className="segmented" role="tablist" aria-label="Conversations">
          {[['open', 'Open'], ['closed', 'Resolved']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value}
              className={filter === value ? 'is-active' : ''}
              onClick={() => setParams(value === 'closed' ? { status: 'closed' } : {})}>
              {label}
            </button>
          ))}
        </div>

        <div className="two-col support-cols">
          <section className={`stack stack-sm ${threadId ? 'hide-on-phone' : ''}`} aria-label="Conversations">
            {threads.loaded && threads.list.length === 0 ? (
              <div className="card empty">
                <span className="empty-icon"><MessageCircle size={28} aria-hidden="true" /></span>
                <p className="muted">{filter === 'open' ? 'No open conversations.' : 'Nothing resolved yet.'}</p>
              </div>
            ) : (
              <ul className="list-card" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {threads.list.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={`list-item list-button ${String(item.id) === threadId ? 'is-selected' : ''}`}
                      onClick={() => open(item.id)}>
                      <span className="list-item-main">
                        <span className="list-item-title">
                          {item.subject}
                          {item.unread > 0 && <span className="nav-count" style={{ marginLeft: 8 }}>{item.unread}</span>}
                        </span>
                        <span className="list-item-meta">
                          {item.user ? `${item.user.name} (${item.user.role}) · ` : ''}{item.last_message}
                        </span>
                      </span>
                      <span className="muted small" style={{ flexShrink: 0 }}>{formatDateTime(item.last_message_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {threadId && (
            <section className="card chat" aria-label="Conversation">
              <div className="chat-head">
                <button type="button" className="icon-btn" onClick={() => open(null)} aria-label="Back to conversations">
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 className="section-title chat-title">{current?.subject || 'Conversation'}</h2>
                  {current?.user && (
                    <p className="muted small">
                      <Link className="text-link" to={`/admin/people?role=${current.user.role === 'driver' ? 'driver' : 'passenger'}&id=${current.user.id}`}>
                        {current.user.name}
                      </Link>{' '}· {current.user.phone}
                    </p>
                  )}
                </div>
                {current && (
                  <button type="button" className="btn btn-sm" onClick={toggleStatus}>
                    {current.status === 'open'
                      ? <><CheckCircle2 size={16} aria-hidden="true" /> Resolve</>
                      : <><RotateCcw size={16} aria-hidden="true" /> Reopen</>}
                  </button>
                )}
              </div>
              {request && (
                <p className="small chat-context">
                  {request.service_type === 'haulage' ? 'Load booking' : 'Ride request'} #{request.id} · {request.route} ·{' '}
                  {request.status.replaceAll('_', ' ')}
                  {request.service_type === 'haulage' && (
                    <> · <Link className="text-link" to="/admin/loads">Send or change the quote</Link></>
                  )}
                </p>
              )}
              {current ? (
                <ChatMessages messages={current.messages} mine={(message) => message.from_staff} />
              ) : (
                <div className="loading-block" role="status"><span className="spinner" aria-hidden="true" /> Loading…</div>
              )}
              <ChatComposer onSend={send} disabled={!current} placeholder="Reply as EkiMove support" />
            </section>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
