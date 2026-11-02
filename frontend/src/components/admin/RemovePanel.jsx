const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** What goes along with the item, from the server's removal check. */
function alsoRemoved(summary) {
  const parts = []
  if (summary.places) parts.push(plural(summary.places, 'place'))
  if (summary.route_fares) parts.push(plural(summary.route_fares, 'route fare'))
  if (summary.zone_fares) parts.push(plural(summary.zone_fares, 'zone fare'))
  if (summary.saved_places) parts.push(plural(summary.saved_places, "passenger's saved shortcut"))
  return parts
}

/**
 * Confirmation shown under a record before it is removed. When the server
 * says it can't be removed (a trip has used it, or places still use a
 * zone), it explains why and offers to set it to Inactive instead.
 */
export default function RemovePanel({ summary, busy, onConfirm, onDeactivate, onClose }) {
  const extras = alsoRemoved(summary)
  return (
    <div className="cancel-panel stack stack-sm" role="alertdialog" aria-labelledby="remove-title"
      style={{ marginTop: 10, flexBasis: '100%' }}>
      <h3 id="remove-title" className="section-title" style={{ fontSize: 16 }}>
        {summary.can_remove ? `Remove ${summary.kind} “${summary.name}”?` : `“${summary.name}” can't be removed`}
      </h3>
      {summary.can_remove ? (
        <p className="small">
          {extras.length ? <>This also removes {extras.join(', ')}. </> : null}
          This can't be undone.
        </p>
      ) : (
        <p className="small">{summary.reason}</p>
      )}
      <div className="row" style={{ gap: 8 }}>
        {summary.can_remove ? (
          <button type="button" className="btn btn-sm btn-danger-outline" disabled={busy} onClick={onConfirm}>
            {busy ? 'Removing…' : 'Yes, remove'}
          </button>
        ) : onDeactivate ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onDeactivate}>
            Set to Inactive
          </button>
        ) : null}
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>
          {summary.can_remove ? 'Keep it' : 'Close'}
        </button>
      </div>
    </div>
  )
}
