import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { getAdminSite, publishSite, saveAdminSite } from '../../services/siteService.js'
import { formatShortDate } from '../../utils/format.js'

// Same limits as the API (app/site_content.py).
const LIMITS = {
  name: [2, 40], tagline: [5, 90], title: [10, 70], description: [50, 170], heading: [3, 100],
  intro: [10, 400], slug: [3, 60], body: [20, 4000], question: [8, 160], answer: [10, 1000],
}
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED = ['fares', 'faq', 'admin', 'api', 'login', 'register', 'driver', 'policies']
const PAGE_NAMES = { home: 'Home page', fares: 'Fares page', faq: 'FAQ page', drive: 'Drive with EkiMove', policies: 'Policies' }
const PAGE_PATHS = { home: '/', fares: '/fares', faq: '/faq', drive: '/driver/apply', policies: '/policies' }
const NEW_AREA = { slug: '', title: '', description: '', heading: '', intro: '', body: '', published: false }

function problem(key, value) {
  const [min, max] = LIMITS[key]
  const length = String(value || '').trim().length
  if (length < min) return `At least ${min} characters (now ${length}).`
  if (length > max) return `At most ${max} characters (now ${length}).`
  return ''
}

function Field({ label, name, value, onChange, multiline = false, rows = 3, hint }) {
  const [, max] = LIMITS[name]
  const error = problem(name, value)
  const length = String(value || '').length
  const id = useId()
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label site-field-label">
        {label}
        <span className={`site-count ${error ? 'is-bad' : ''}`}>{length}/{max}</span>
      </span>
      <Tag id={id} className="input" value={value} rows={multiline ? rows : undefined} maxLength={max}
        aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      {error ? <span className="field-hint field-hint-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function SearchPreview({ siteUrl, path, title, description }) {
  return (
    <div className="search-preview" aria-label="How this may look on Google">
      <span className="search-preview-url">{[siteUrl.replace(/^https?:\/\//, ''), ...path.split('/').filter(Boolean)].join(' › ')}</span>
      <span className="search-preview-title">{title || 'Page title'}</span>
      <span className="search-preview-text">{description || 'Description'}</span>
    </div>
  )
}

function validate(content) {
  const errors = []
  const check = (where, key, value) => {
    const message = problem(key, value)
    if (message) errors.push(`${where}: ${key} — ${message}`)
  }
  check('Site', 'name', content.site.name)
  check('Site', 'tagline', content.site.tagline)
  check('Site', 'description', content.site.description)
  Object.entries(content.pages).forEach(([key, page]) => {
    ;['title', 'description', 'heading', 'intro'].forEach((field) => field in page && check(PAGE_NAMES[key], field, page[field]))
  })
  const slugs = new Set()
  content.areas.forEach((area, index) => {
    const where = `Area page ${index + 1}`
    ;['slug', 'title', 'description', 'heading', 'intro', 'body'].forEach((field) => check(where, field, area[field]))
    if (!SLUG_RE.test(area.slug)) errors.push(`${where}: the address can only use lower-case letters, numbers and hyphens.`)
    if (RESERVED.includes(area.slug)) errors.push(`${where}: “${area.slug}” is used by another page.`)
    if (slugs.has(area.slug)) errors.push(`${where}: another area page already uses /areas/${area.slug}.`)
    slugs.add(area.slug)
  })
  content.faq.forEach((item, index) => {
    check(`Question ${index + 1}`, 'question', item.question)
    check(`Question ${index + 1}`, 'answer', item.answer)
  })
  return errors
}

const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

function move(list, index, step) {
  const next = [...list]
  const target = index + step
  if (target < 0 || target >= next.length) return list
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export default function AdminWebsitePage() {
  const [data, setData] = useState(null)
  const [content, setContent] = useState(null)
  const [saved, setSaved] = useState('')
  const [tab, setTab] = useState('pages')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [issues, setIssues] = useState([])

  useEffect(() => {
    getAdminSite()
      .then((result) => {
        setData(result)
        setContent(result.content)
        setSaved(JSON.stringify(result.content))
      })
      .catch((err) => setError(err.message || 'Could not load the website content.'))
  }, [])

  const dirty = useMemo(() => content && JSON.stringify(content) !== saved, [content, saved])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const setSite = (key) => (value) => setContent((c) => ({ ...c, site: { ...c.site, [key]: value } }))
  const setPage = (page, key) => (value) =>
    setContent((c) => ({ ...c, pages: { ...c.pages, [page]: { ...c.pages[page], [key]: value } } }))
  const setArea = (index, key) => (value) =>
    setContent((c) => ({ ...c, areas: c.areas.map((a, i) => (i === index ? { ...a, [key]: value } : a)) }))
  const setFaq = (index, key) => (value) =>
    setContent((c) => ({ ...c, faq: c.faq.map((q, i) => (i === index ? { ...q, [key]: value } : q)) }))

  async function save() {
    setError('')
    setNotice('')
    const found = validate(content)
    setIssues(found)
    if (found.length) return
    setBusy('save')
    try {
      const result = await saveAdminSite(content)
      setData(result)
      setContent(result.content)
      setSaved(JSON.stringify(result.content))
      setNotice('Saved. Press “Publish to website” when you want search engines to see the changes.')
    } catch (err) {
      setError(err.message || 'Could not save.')
    } finally {
      setBusy('')
    }
  }

  async function publish() {
    setError('')
    setNotice('')
    setBusy('publish')
    try {
      const result = await publishSite()
      setData((d) => ({ ...d, published_at: result.published_at }))
      setNotice(result.message)
    } catch (err) {
      setError(err.message || 'Could not publish.')
    } finally {
      setBusy('')
    }
  }

  const actions = content && (
    <div className="site-actions">
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || Boolean(busy)}>
        {busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
      <button type="button" className="btn btn-gold btn-sm" onClick={publish}
        disabled={dirty || Boolean(busy) || !data?.publish_available}
        title={dirty ? 'Save your changes first' : undefined}>
        {busy === 'publish' ? 'Publishing…' : 'Publish to website'}
      </button>
    </div>
  )

  return (
    <AdminShell title="SEO & website"
      description="The words Google, WhatsApp and Facebook show for EkiMove’s public pages, the area pages and the FAQ."
      actions={actions}>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <Alert tone="error">
        {issues.length > 0 && (
          <>
            <strong>Fix these before saving:</strong>
            <ul className="site-issues">{issues.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul>
          </>
        )}
      </Alert>
      {!content && !error && <p className="muted">Loading…</p>}

      {content && (
        <>
          <section className="card site-status">
            <div>
              <strong>Website address:</strong> <a href={data.site_url} target="_blank" rel="noreferrer">{data.site_url}</a>
            </div>
            <div className="muted small">
              Last saved {data.saved_at ? formatShortDate(data.saved_at) : 'never (showing the starting text)'} ·
              Last published {data.published_at ? formatShortDate(data.published_at) : 'never'}
            </div>
            <div className="site-launch">
              <span className="field-label" id="launch-status-label">Launch status</span>
              <div className="chip-row" role="radiogroup" aria-labelledby="launch-status-label">
                {[['coming_soon', 'Coming soon'], ['live', 'Now live']].map(([value, text]) => (
                  <button key={value} type="button" role="radio" aria-checked={content.site.launch_status === value}
                    className={`chip ${content.site.launch_status === value ? 'is-active' : ''}`}
                    onClick={() => setSite('launch_status')(value)}>{text}</button>
                ))}
              </div>
              <span className="muted small">
                The home page says “{content.site.launch_status === 'live' ? 'Now live in Ado-Ekiti' : 'Coming soon to Ado-Ekiti'}”.
                Switch to “Now live” on launch day, then Save changes.
              </span>
            </div>
            {!data.publish_available && (
              <p className="small site-warn">
                Publishing isn’t set up yet. In Render, open the ekimove static site, Settings, Deploy Hook, copy it,
                then add it to the ekimove-api service as the environment variable RENDER_DEPLOY_HOOK_URL. Until then,
                saved changes appear in the app straight away and reach search engines at the next deploy.
              </p>
            )}
          </section>

          <nav className="chip-row" aria-label="Sections">
            {[['pages', 'Page titles'], ['areas', `Area pages (${content.areas.length})`], ['faq', `FAQ (${content.faq.length})`], ['site', 'Business']].map(([key, label]) => (
              <button key={key} type="button" className={`chip ${tab === key ? 'is-active' : ''}`} aria-pressed={tab === key}
                onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>

          {tab === 'site' && (
            <section className="card stack">
              <h2 className="section-title">Business</h2>
              <Field label="Name" name="name" value={content.site.name} onChange={setSite('name')} />
              <Field label="Tagline" name="tagline" value={content.site.tagline} onChange={setSite('tagline')}
                hint="Used as the main line when a page has no title of its own." />
              <Field label="Short description" name="description" value={content.site.description} multiline
                onChange={setSite('description')} hint="Used for Google’s business details and link previews." />
            </section>
          )}

          {tab === 'pages' && Object.keys(PAGE_NAMES).map((key) => {
            const page = content.pages[key]
            return (
              <section key={key} className="card stack">
                <div className="site-card-head">
                  <h2 className="section-title">{PAGE_NAMES[key]}</h2>
                  <a className="small" href={PAGE_PATHS[key]} target="_blank" rel="noreferrer">
                    Open <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
                <SearchPreview siteUrl={data.site_url} path={PAGE_PATHS[key]} title={page.title} description={page.description} />
                <Field label="Search title" name="title" value={page.title} onChange={setPage(key, 'title')}
                  hint="Put the most important words first. About 50 to 60 characters shows in full." />
                <Field label="Search description" name="description" value={page.description} multiline
                  onChange={setPage(key, 'description')} hint="About 120 to 160 characters. Say what people can do here." />
                {'heading' in page && (
                  <>
                    <Field label="Heading on the page" name="heading" value={page.heading} onChange={setPage(key, 'heading')} />
                    <Field label="Introduction" name="intro" value={page.intro} multiline onChange={setPage(key, 'intro')} />
                  </>
                )}
              </section>
            )
          })}

          {tab === 'areas' && (
            <>
              <p className="muted small">
                Each area page has its own address, like /areas/eksu-iworoko, so people searching for that place can find
                EkiMove. Write for people, mention real landmarks, and don’t copy the same text into every page.
              </p>
              {content.areas.map((area, index) => (
                <section key={index} className="card stack">
                  <div className="site-card-head">
                    <h2 className="section-title">{area.heading || 'New area page'}</h2>
                    <div className="site-row-actions">
                      <label className="check-row">
                        <input type="checkbox" checked={area.published}
                          onChange={(event) => setArea(index, 'published')(event.target.checked)} />
                        Published
                      </label>
                      <button type="button" className="icon-btn" aria-label="Remove this area page"
                        onClick={() => window.confirm(`Remove “${area.heading || 'this page'}”?`) &&
                          setContent((c) => ({ ...c, areas: c.areas.filter((_, i) => i !== index) }))}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <SearchPreview siteUrl={data.site_url} path={`/areas/${area.slug || '…'}`} title={area.title} description={area.description} />
                  <Field label="Address (after /areas/)" name="slug" value={area.slug}
                    onChange={(value) => setArea(index, 'slug')(value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    hint="Changing it later breaks links people have saved." />
                  <Field label="Heading on the page" name="heading" value={area.heading}
                    onChange={(value) => {
                      setArea(index, 'heading')(value)
                      if (!area.slug) setArea(index, 'slug')(slugify(value))
                    }} />
                  <Field label="Search title" name="title" value={area.title} onChange={setArea(index, 'title')} />
                  <Field label="Search description" name="description" value={area.description} multiline onChange={setArea(index, 'description')} />
                  <Field label="Introduction" name="intro" value={area.intro} multiline onChange={setArea(index, 'intro')} />
                  <Field label="Main text" name="body" value={area.body} multiline rows={8} onChange={setArea(index, 'body')}
                    hint="Leave a blank line between paragraphs." />
                </section>
              ))}
              {content.areas.length < 20 && (
                <div>
                  <button type="button" className="btn btn-quiet btn-sm"
                    onClick={() => setContent((c) => ({ ...c, areas: [...c.areas, { ...NEW_AREA }] }))}>
                    <Plus size={16} aria-hidden="true" /> Add an area page
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'faq' && (
            <>
              <p className="muted small">These answers appear on /faq and can show directly in Google results.</p>
              {content.faq.map((item, index) => (
                <section key={index} className="card stack">
                  <div className="site-card-head">
                    <h2 className="section-title">Question {index + 1}</h2>
                    <div className="site-row-actions">
                      <button type="button" className="icon-btn" aria-label="Move up" disabled={index === 0}
                        onClick={() => setContent((c) => ({ ...c, faq: move(c.faq, index, -1) }))}><ArrowUp size={18} /></button>
                      <button type="button" className="icon-btn" aria-label="Move down" disabled={index === content.faq.length - 1}
                        onClick={() => setContent((c) => ({ ...c, faq: move(c.faq, index, 1) }))}><ArrowDown size={18} /></button>
                      <button type="button" className="icon-btn" aria-label="Remove this question"
                        onClick={() => window.confirm('Remove this question?') &&
                          setContent((c) => ({ ...c, faq: c.faq.filter((_, i) => i !== index) }))}><Trash2 size={18} /></button>
                    </div>
                  </div>
                  <Field label="Question" name="question" value={item.question} onChange={setFaq(index, 'question')} />
                  <Field label="Answer" name="answer" value={item.answer} multiline rows={4} onChange={setFaq(index, 'answer')} />
                </section>
              ))}
              {content.faq.length < 30 && (
                <div>
                  <button type="button" className="btn btn-quiet btn-sm"
                    onClick={() => setContent((c) => ({ ...c, faq: [...c.faq, { question: '', answer: '' }] }))}>
                    <Plus size={16} aria-hidden="true" /> Add a question
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </AdminShell>
  )
}
