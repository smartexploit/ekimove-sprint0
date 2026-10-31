import { useEffect, useState } from 'react'

const DISMISS_KEY = 'ekimove-install-dismissed-at'
const DISMISS_DAYS = 14
const EVENT = 'ekimove:installable'

let deferredPrompt = null

/**
 * Chrome/Android fire `beforeinstallprompt` early, often before React
 * renders, so keep the event from the start. Called once from main.jsx.
 */
export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    window.dispatchEvent(new Event(EVENT))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    window.dispatchEvent(new Event(EVENT))
  })
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isIosSafari() {
  const ua = window.navigator.userAgent || ''
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1)
  const otherBrowser = /crios|fxios|edgios|opios/i.test(ua)
  return ios && !otherBrowser
}

function recentlyDismissed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY))
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

/**
 * What install option to show: 'prompt' (Chrome/Android can install with
 * one tap), 'ios' (Safari needs Share → Add to Home Screen) or null.
 */
export default function useInstallPrompt() {
  const [, setVersion] = useState(0)
  const [dismissed, setDismissed] = useState(() => recentlyDismissed())

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener(EVENT, refresh)
    return () => window.removeEventListener(EVENT, refresh)
  }, [])

  let mode = null
  if (!dismissed && !isStandalone()) {
    if (deferredPrompt) mode = 'prompt'
    else if (isIosSafari()) mode = 'ios'
  }

  async function install() {
    if (!deferredPrompt) return
    const promptEvent = deferredPrompt
    deferredPrompt = null
    promptEvent.prompt()
    try {
      await promptEvent.userChoice
    } finally {
      setVersion((value) => value + 1)
    }
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Private browsing: just hide it for this visit.
    }
    setDismissed(true)
  }

  return { mode, install, dismiss }
}
