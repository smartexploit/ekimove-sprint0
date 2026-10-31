import { Share, SquarePlus } from 'lucide-react'
import useInstallPrompt from '../../hooks/useInstallPrompt.js'

/** Invites people to add EkiMove to their home screen. */
export default function InstallAppCard({ className = '' }) {
  const { mode, install, dismiss } = useInstallPrompt()
  if (!mode) return null

  return (
    <aside className={`install-card ${className}`.trim()} aria-label="Install the EkiMove app">
      <img src="/brand/ekimove-app-icon-192.png" alt="" />
      <div className="install-card-body">
        <p className="install-card-title">Get the EkiMove app</p>
        {mode === 'prompt' ? (
          <p className="install-card-text">
            Add EkiMove to your home screen for one-tap booking. It's free and opens like an app.
          </p>
        ) : (
          <p className="install-card-text">
            Tap <Share size={15} aria-label="Share" style={{ display: 'inline', verticalAlign: '-2px' }} />{' '}
            then <strong>Add to Home Screen</strong>{' '}
            <SquarePlus size={15} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> to
            open EkiMove like an app.
          </p>
        )}
        <div className="install-card-actions">
          {mode === 'prompt' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={install}>
              Install app
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    </aside>
  )
}
