import { useEffect, useState } from 'react'
import { apiRequest } from '../services/authService.js'

const EMPTY = {
  bank_transfer: {
    configured: false,
    bank_name: null,
    account_number: null,
    account_name: null,
  },
  support: { phone: null, email: null, whatsapp: null },
  instant_transfers: { enabled: false },
  cancellation: { free_seconds: 120, fee_motorcycle: 0, fee_car: 0 },
}

let cached = null
let pending = null

function loadBusinessInfo() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = apiRequest('/api/v1/business-info')
      .then((data) => {
        cached = {
          bank_transfer: { ...EMPTY.bank_transfer, ...(data?.bank_transfer || {}) },
          support: { ...EMPTY.support, ...(data?.support || {}) },
          instant_transfers: { ...EMPTY.instant_transfers, ...(data?.instant_transfers || {}) },
          cancellation: { ...EMPTY.cancellation, ...(data?.cancellation || {}) },
        }
        return cached
      })
      .catch(() => EMPTY)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/**
 * Bank-transfer account and support contacts configured on the server
 * (BANK_TRANSFER_* and SUPPORT_* settings). Missing values stay null so the
 * UI can say they are not available yet instead of showing placeholders.
 */
export default function useBusinessInfo() {
  const [info, setInfo] = useState(cached || EMPTY)
  const [loaded, setLoaded] = useState(Boolean(cached))

  useEffect(() => {
    let active = true
    loadBusinessInfo().then((data) => {
      if (!active) return
      setInfo(data)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  return { ...info, loaded }
}

export function hasSupportContact(support) {
  return Boolean(support?.phone || support?.email || support?.whatsapp)
}

export function whatsappLink(number) {
  const digits = String(number || '').replace(/\D/g, '')
  if (!digits) return null
  const international = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  return `https://wa.me/${international}`
}
