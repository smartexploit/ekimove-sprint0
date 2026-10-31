// Phone notifications (Web Push) helpers.
import { getPushConfig, removePushSubscription, savePushSubscription } from '../services/accountService.js'

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window
}

/** iPhone/iPad Safari only allows notifications from the Home Screen app. */
export function needsHomeScreen() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  return ios && !standalone
}

function keyBytes(base64url) {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function registration() {
  if (!pushSupported()) return null
  return (await navigator.serviceWorker.getRegistration()) || null
}

export async function currentSubscription() {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** Ask permission (must run straight from a tap) and subscribe this phone. */
export async function turnOnNotifications() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for EkiMove. Allow them in your browser or phone settings, then try again.'
      : 'Notifications were not allowed.')
  }
  const reg = await registration()
  if (!reg) throw new Error('Open EkiMove from your Home Screen app (or reload the page) and try again.')
  const config = await getPushConfig()
  if (!config.enabled || !config.public_key) throw new Error('Notifications are switched off on EkiMove right now.')
  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(config.public_key),
    })
  }
  await savePushSubscription(subscription.toJSON())
  return subscription
}

export async function turnOffNotifications() {
  const subscription = await currentSubscription()
  if (!subscription) return
  await removePushSubscription(subscription.endpoint).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}

/** After sign-in, link this phone's notifications to whoever is signed in. */
export async function syncNotifications() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    const subscription = await currentSubscription()
    if (subscription) await savePushSubscription(subscription.toJSON())
  } catch {
    /* best effort */
  }
}
