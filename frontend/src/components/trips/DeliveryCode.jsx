import { useState } from 'react'
import { Send } from 'lucide-react'

/** The sender's view of the drop-off code, with a way to pass it on. */
export default function DeliveryCode({ ride }) {
  const [notice, setNotice] = useState('')
  const delivery = ride.delivery
  if (!delivery || !ride.delivery_code) return null
  const link = ride.share_path ? `${window.location.origin}${ride.share_path}` : ''
  const message = `Your EkiMove package is coming. Give the rider this code only when you have it: ${ride.delivery_code}.`
    + (link ? ` Track it: ${link}` : '')

  async function share() {
    setNotice('')
    try {
      if (navigator.share) await navigator.share({ text: message })
      else {
        await navigator.clipboard.writeText(message)
        setNotice('Copied. Paste it in WhatsApp or a text to the recipient.')
      }
    } catch {
      /* share sheet closed */
    }
  }

  return (
    <div className="delivery-code" role="group" aria-label="Delivery code">
      <span className="small">Delivery code for {delivery.recipient_name}</span>
      <strong className="code">{ride.delivery_code}</strong>
      <span className="small">
        The rider hands over the package only when {delivery.recipient_name} gives this code.
        {ride.share_path ? ' We’ve also texted them a tracking link where text messages are set up.' : ''}
      </span>
      <div>
        <button type="button" className="btn btn-sm" onClick={share}>
          <Send size={16} aria-hidden="true" /> Send code to {delivery.recipient_name.split(' ')[0]}
        </button>
      </div>
      {notice && <span className="small" role="status">{notice}</span>}
    </div>
  )
}
