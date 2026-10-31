import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import AdminShell from '../../layouts/AdminShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import { getReportSummary } from '../../services/accountService.js'
import { downloadFile } from '../../services/authService.js'
import { formatNaira } from '../../utils/format.js'

const lagosDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(date)
const DAY_MS = 24 * 60 * 60 * 1000

function presetRange(name) {
  const today = lagosDate(new Date())
  if (name === 'month') return [`${today.slice(0, 8)}01`, today]
  const days = name === 'week' ? 6 : 29
  return [lagosDate(new Date(Date.now() - days * DAY_MS)), today]
}

const PRESETS = [['week', 'Last 7 days'], ['month', 'This month'], ['30', 'Last 30 days']]
const HEADLINES = [
  ['completed_trips', 'Completed trips'],
  ['payments_amount', 'Payments received'],
  ['commission', 'EkiMove commission'],
  ['driver_earnings', 'Driver earnings'],
  ['payouts_paid', 'Payouts sent'],
  ['refunds_paid', 'Refunds paid'],
  ['new_passengers', 'New passengers'],
  ['new_drivers', 'New drivers'],
]
const DOWNLOADS = [
  ['daily', 'Daily summary'],
  ['trips', 'Trips'],
  ['payments', 'Payments'],
  ['payouts', 'Driver payouts'],
]

function cell(field, value) {
  return field.money ? formatNaira(value, { decimals: 0 }) : value
}

export default function AdminReportsPage() {
  const [range, setRange] = useState(() => presetRange('30'))
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')

  const load = useCallback(async (start, end) => {
    setError('')
    try {
      setReport(await getReportSummary(start, end))
    } catch (err) {
      setError(err.message || 'Could not load the report.')
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => active && load(range[0], range[1]))
    return () => {
      active = false
    }
  }, [load, range])

  async function download(kind) {
    setDownloading(kind)
    setError('')
    try {
      await downloadFile(`/api/v1/admin/reports/export?kind=${kind}&start=${range[0]}&end=${range[1]}`,
        `ekimove-${kind}.csv`)
    } catch (err) {
      setError(err.message || 'Could not download the file.')
    } finally {
      setDownloading('')
    }
  }

  const fields = report?.fields || []
  const money = Object.fromEntries(fields.map((field) => [field.key, field.money]))
  const days = report ? [...report.days].reverse() : []

  return (
    <AdminShell title="Reports" description="Daily totals in Lagos time, and spreadsheet downloads for your records.">
      <div className="stack">
        <section className="card stack stack-sm" aria-labelledby="range-title">
          <h2 id="range-title" className="section-title">Dates</h2>
          <div className="chip-row">
            {PRESETS.map(([name, label]) => (
              <button key={name} type="button" className="chip" onClick={() => setRange(presetRange(name))}>
                {label}
              </button>
            ))}
          </div>
          <div className="date-row">
            <label className="field">
              <span className="field-label">From</span>
              <input className="input" type="date" value={range[0]} max={range[1]} required
                onChange={(event) => event.target.value && setRange([event.target.value, range[1]])} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input className="input" type="date" value={range[1]} min={range[0]} required
                onChange={(event) => event.target.value && setRange([range[0], event.target.value])} />
            </label>
          </div>
        </section>

        <Alert tone="error">{error}</Alert>

        {report && (
          <>
            <div className="stat-grid">
              {HEADLINES.map(([key, label]) => (
                <div className="stat" key={key}>
                  <p className="stat-label">{label}</p>
                  <p className="stat-value">{money[key] ? formatNaira(report.totals[key], { decimals: 0 }) : report.totals[key]}</p>
                </div>
              ))}
            </div>

            <section className="card stack stack-sm" aria-labelledby="downloads-title">
              <h2 id="downloads-title" className="section-title">Download (CSV)</h2>
              <p className="muted small">Opens in Excel or Google Sheets. Covers {report.start} to {report.end}.</p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                {DOWNLOADS.map(([kind, label]) => (
                  <button key={kind} type="button" className="btn btn-sm" disabled={Boolean(downloading)}
                    onClick={() => download(kind)}>
                    <Download size={16} aria-hidden="true" /> {downloading === kind ? 'Preparing…' : label}
                  </button>
                ))}
              </div>
            </section>

            <section className="card stack stack-sm" aria-labelledby="daily-title">
              <h2 id="daily-title" className="section-title">Day by day</h2>
              <div className="report-table-wrap" tabIndex={0} aria-label="Daily totals, scroll sideways for more">
                <table className="report-table">
                  <thead>
                    <tr>{fields.map((field) => <th key={field.key} scope="col">{field.label.replace(' (NGN)', '')}</th>)}</tr>
                  </thead>
                  <tbody>
                    {days.map((row) => (
                      <tr key={row.date}>
                        {fields.map((field) => <td key={field.key}>{cell(field, row[field.key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      {fields.map((field) => (
                        <td key={field.key}>{field.key === 'date' ? 'Total' : cell(field, report.totals[field.key])}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  )
}
