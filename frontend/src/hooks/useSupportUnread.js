import { useEffect, useState } from 'react'
import { getSupportUnread } from '../services/accountService.js'

/** Number of support conversations with replies not yet read (polls). */
export default function useSupportUnread(enabled = true) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    const load = () => getSupportUnread()
      .then((data) => active && setUnread(Number(data?.unread) || 0))
      .catch(() => {})
    load()
    const timer = window.setInterval(load, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [enabled])
  return unread
}
