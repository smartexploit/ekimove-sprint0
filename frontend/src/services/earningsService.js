import { apiRequest } from './authService.js'

export const getDriverEarnings = () => apiRequest('/api/v1/driver/earnings')
export const getPayoutAccount = () => apiRequest('/api/v1/driver/payout-account')
export const listBanks = () => apiRequest('/api/v1/banks')

export function savePayoutAccount({ bankCode, accountNumber, accountName }) {
  return apiRequest('/api/v1/driver/payout-account', {
    method: 'PUT',
    body: JSON.stringify({
      bank_code: bankCode,
      account_number: accountNumber.trim(),
      ...(accountName ? { account_name: accountName.trim() } : {}),
    }),
  })
}

export const getEarningsSummary = () => apiRequest('/api/v1/admin/earnings/summary')
export const listPayouts = (status = 'open') => apiRequest(`/api/v1/admin/payouts?status=${status}`)
export const runPayouts = () => apiRequest('/api/v1/admin/payouts/run', { method: 'POST' })

export function markPayoutPaid(id, bankReference) {
  return apiRequest(`/api/v1/admin/payouts/${id}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify({ bank_reference: bankReference.trim() }),
  })
}

export function markPayoutFailed(id, reason) {
  return apiRequest(`/api/v1/admin/payouts/${id}/mark-failed`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() }),
  })
}
