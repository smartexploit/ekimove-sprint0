import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Flag, Printer } from 'lucide-react'
import AppShell from '../../layouts/AppShell.jsx'
import Alert from '../../components/ui/Alert.jsx'
import Logo from '../../components/brand/Logo.jsx'
import { getReceipt } from '../../services/tripService.js'
import { formatDateTime, formatNaira } from '../../utils/format.js'
import { vehicleLabel } from '../../utils/vehicles.js'

const METHOD = { bank_transfer: 'Bank transfer', interswitch: 'Card (Interswitch)' }

export default function ReceiptPage() {
  const { rideId } = useParams()
  const [receipt, setReceipt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getReceipt(rideId)
      .then((data) => active && setReceipt(data))
      .catch((err) => active && setError(err.message || 'Could not load this receipt.'))
    return () => {
      active = false
    }
  }, [rideId])

  const subject = encodeURIComponent(`Problem with trip ${receipt?.receipt_number || ''}`.trim())

  return (
    <AppShell title="Receipt" description="Print it or save it as a PDF from your browser.">
      <Alert tone="error">{error}</Alert>
      {receipt && (
        <div className="stack" style={{ maxWidth: 640 }}>
          <article className="card receipt" aria-label={`Receipt ${receipt.receipt_number}`}>
            <div className="row row-between">
              <Logo size={30} />
              <div style={{ textAlign: 'right' }}>
                <p className="small muted">Receipt</p>
                <p style={{ fontWeight: 800 }}>{receipt.receipt_number}</p>
              </div>
            </div>
            <p className="receipt-amount">{formatNaira(receipt.fare)}</p>
            <p className="muted small">
              {receipt.status === 'completed' ? 'Trip completed' : 'Trip cancelled'} ·{' '}
              {formatDateTime(receipt.trip_date)}
            </p>
            <dl className="rows small">
              <div><dt>From</dt><dd>{receipt.origin}</dd></div>
              <div><dt>To</dt><dd>{receipt.destination}</dd></div>
              <div><dt>Vehicle</dt><dd>{vehicleLabel(receipt.vehicle_type)}{receipt.plate_number ? ` · ${receipt.plate_number}` : ''}</dd></div>
              <div><dt>Driver</dt><dd>{receipt.driver_name || '—'}</dd></div>
              <div><dt>Passenger</dt><dd>{receipt.passenger_name}</dd></div>
              {receipt.started_at && <div><dt>Started</dt><dd>{formatDateTime(receipt.started_at)}</dd></div>}
              {receipt.completed_at && <div><dt>Ended</dt><dd>{formatDateTime(receipt.completed_at)}</dd></div>}
              <div><dt>Payment</dt><dd>{receipt.paid ? METHOD[receipt.payment_method] || 'Paid' : 'Not paid'}</dd></div>
              {receipt.payment_reference && <div><dt>Reference</dt><dd style={{ wordBreak: 'break-all' }}>{receipt.payment_reference}</dd></div>}
              {receipt.cancellation_fee && <div><dt>Cancellation fee</dt><dd>{formatNaira(receipt.cancellation_fee)}</dd></div>}
              {receipt.refund_amount && (
                <div><dt>Refund</dt><dd>{formatNaira(receipt.refund_amount)} ({receipt.refund_status === 'paid' ? 'sent' : 'on the way'})</dd></div>
              )}
              {receipt.driver_earning && (
                <div><dt>Your earning</dt><dd>{formatNaira(receipt.driver_earning.earning)} after {formatNaira(receipt.driver_earning.commission)} commission</dd></div>
              )}
            </dl>
            <p className="muted small">
              EkiMove · Ekiti, Nigeria
              {receipt.business.support_email ? ` · ${receipt.business.support_email}` : ''}
              {receipt.business.support_phone ? ` · ${receipt.business.support_phone}` : ''}
            </p>
          </article>
          <div className="row no-print">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print or save PDF
            </button>
            <Link className="btn" to={`/support?new=1&subject=${subject}`}>
              <Flag size={16} aria-hidden="true" /> Report a problem
            </Link>
          </div>
        </div>
      )}
    </AppShell>
  )
}
