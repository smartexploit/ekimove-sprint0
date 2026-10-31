import { useEffect, useState } from 'react'
import { apiRequest } from '../services/authService.js'

let cached = null
let pending = null

function loadStatus() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = apiRequest('/api/v1/atona/status')
      .then((data) => {
        cached = { available: Boolean(data?.available) }
        return cached
      })
      .catch(() => ({ available: false }))
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** Whether Atọ́nà is switched on; the launcher stays hidden until it is. */
export default function useAtonaStatus() {
  const [available, setAvailable] = useState(Boolean(cached?.available))

  useEffect(() => {
    let active = true
    loadStatus().then((status) => {
      if (active) setAvailable(status.available)
    })
    return () => {
      active = false
    }
  }, [])

  return available
}
