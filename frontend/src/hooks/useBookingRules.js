import { useEffect, useState } from 'react'
import { getBookingRules } from '../services/accountService.js'

const DEFAULT_RULES = {
  motorcycle_second_passenger_enabled: true,
  motorcycle_second_passenger_fee: 200,
  max_passengers: { motorcycle: 2, car: 4 },
}

let cached = null

/** Passenger limits and the motorcycle second-passenger charge (admin-set). */
export default function useBookingRules() {
  const [rules, setRules] = useState(cached || DEFAULT_RULES)
  useEffect(() => {
    if (cached) return undefined
    let active = true
    getBookingRules()
      .then((data) => {
        cached = { ...DEFAULT_RULES, ...data }
        if (active) setRules(cached)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return rules
}
