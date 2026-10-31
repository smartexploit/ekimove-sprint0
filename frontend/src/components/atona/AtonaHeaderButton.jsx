import { Sparkles } from 'lucide-react'
import useAtonaStatus from '../../hooks/useAtonaStatus.js'
import { openAtona } from '../../utils/atona.js'

/**
 * Phone-only header entry for Atọ́nà. On small screens it replaces the
 * floating button, which would otherwise sit on top of page content.
 */
export default function AtonaHeaderButton({ className = '' }) {
  const available = useAtonaStatus()
  if (!available) return null

  return (
    <button
      type="button"
      className={`icon-btn atona-header-btn ${className}`.trim()}
      onClick={openAtona}
      aria-label="Ask Atọ́nà"
    >
      <Sparkles size={20} aria-hidden="true" />
    </button>
  )
}
