import { Mail, MessageCircle, Phone } from 'lucide-react'
import useBusinessInfo, {
  hasSupportContact,
  whatsappLink,
} from '../hooks/useBusinessInfo.js'

/**
 * Support channels configured on the server. Renders `fallback` (or
 * nothing) until at least one contact has been set.
 */
export default function SupportContacts({
  className = 'stack stack-sm',
  linkClassName = '',
  fallback = null,
}) {
  const { support } = useBusinessInfo()

  if (!hasSupportContact(support)) return fallback

  const whatsapp = whatsappLink(support.whatsapp)

  return (
    <div className={className}>
      {support.phone && (
        <a className={linkClassName} href={`tel:${support.phone.replace(/\s+/g, '')}`}>
          <Phone size={16} aria-hidden="true" /> {support.phone}
        </a>
      )}
      {whatsapp && (
        <a className={linkClassName} href={whatsapp} target="_blank" rel="noreferrer">
          <MessageCircle size={16} aria-hidden="true" /> WhatsApp {support.whatsapp}
        </a>
      )}
      {support.email && (
        <a className={linkClassName} href={`mailto:${support.email}`}>
          <Mail size={16} aria-hidden="true" /> {support.email}
        </a>
      )}
    </div>
  )
}
