import { Link, useOutletContext } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { initials } from '../utils/format.js'

/** Compact "your profile" card for dashboards. */
export default function ProfileStrip() {
  const user = useOutletContext()?.user
  if (!user) return null
  return (
    <Link className="card profile-strip" to="/profile" aria-label="Open your profile">
      <span className="avatar" aria-hidden="true">{initials(user.full_name)}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="list-item-title" style={{ display: 'block' }}>{user.full_name}</span>
        <span className="muted small">{user.phone} · View profile</span>
      </span>
      <ChevronRight size={20} aria-hidden="true" />
    </Link>
  )
}
