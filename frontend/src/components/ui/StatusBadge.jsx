import { titleCase } from '../../utils/format.js'

const STATUS = {
  ride: {
    requested: ['Requested', 'gold'],
    assigned: ['Driver assigned', 'green'],
    driver_arriving: ['Driver arriving', 'bright'],
    in_progress: ['On the way', 'solid'],
    completed: ['Completed', 'neutral'],
    cancelled: ['Cancelled', 'red'],
    incident_review: ['Safety review', 'red'],
  },
  driverTrip: {
    assigned: ['Assigned', 'green'],
    driver_arriving: ['Arrived at pickup', 'bright'],
    in_progress: ['Trip in progress', 'solid'],
    completed: ['Completed', 'neutral'],
    cancelled: ['Cancelled', 'red'],
    incident_review: ['Incident under review', 'red'],
  },
  payment: {
    pending: ['Not yet paid', 'gold'],
    awaiting_confirmation: ['Awaiting verification', 'gold'],
    confirmed: ['Paid', 'green'],
    rejected: ['Rejected', 'red'],
    refunded: ['Refunded', 'neutral'],
  },
  verification: {
    pending: ['Under review', 'gold'],
    approved: ['Approved', 'green'],
    rejected: ['Not approved', 'red'],
    suspended: ['Suspended', 'red'],
  },
  incident: {
    open: ['Open', 'red'],
    investigating: ['Investigating', 'gold'],
    resolved: ['Resolved', 'green'],
  },
  area: {
    draft: ['Draft', 'neutral'],
    pending: ['Pending', 'gold'],
    active: ['Active', 'green'],
    inactive: ['Inactive', 'neutral'],
  },
}

export default function StatusBadge({ status, kind = 'ride' }) {
  const [label, tone] = STATUS[kind]?.[status] || [
    titleCase(status) || 'Unknown',
    'neutral',
  ]

  return (
    <span className={`badge ${tone === 'neutral' ? '' : `badge-${tone}`}`.trim()}>
      {label}
    </span>
  )
}
