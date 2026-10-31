import { apiRequest, updateAccessToken } from './authService.js'

const json = (method, body) => ({ method, body: JSON.stringify(body) })

// Profile and session
export const getProfile = () => apiRequest('/api/v1/me')
export const updateProfile = (changes) => apiRequest('/api/v1/me', json('PATCH', changes))

export async function changePassword(currentPassword, newPassword) {
  const data = await apiRequest('/api/v1/me/password',
    json('POST', { current_password: currentPassword, new_password: newPassword }))
  updateAccessToken(data.access_token)
  return data
}

export async function refreshSession() {
  const data = await apiRequest('/api/v1/auth/refresh', { method: 'POST' })
  updateAccessToken(data.access_token)
  return data
}

// Booking rules
export const getBookingRules = () => apiRequest('/api/v1/booking-rules')

// Support chat
export const listMyThreads = () => apiRequest('/api/v1/support/threads')
export const getMyThread = (id) => apiRequest(`/api/v1/support/threads/${id}`)
export const startThread = (subject, message, rideRequestId) =>
  apiRequest('/api/v1/support/threads', json('POST', {
    subject, message, ...(rideRequestId ? { ride_request_id: rideRequestId } : {}),
  }))
export const sendMyMessage = (id, body) =>
  apiRequest(`/api/v1/support/threads/${id}/messages`, json('POST', { body }))
export const getSupportUnread = () => apiRequest('/api/v1/support/unread')

// Loads (haulage)
export const listMyLoads = () => apiRequest('/api/v1/haulage-requests')
export const requestLoad = (payload) => apiRequest('/api/v1/haulage-requests', json('POST', payload))
export const acceptLoadQuote = (id) => apiRequest(`/api/v1/haulage-requests/${id}/accept`, { method: 'POST' })
export const declineLoadQuote = (id) => apiRequest(`/api/v1/haulage-requests/${id}/decline`, { method: 'POST' })

// Admin
export const getOverview = () => apiRequest('/api/v1/admin/overview')
export const listPeople = ({ role, status = 'all', q = '' }) =>
  apiRequest(`/api/v1/admin/people?role=${role}&status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
export const getPerson = (id) => apiRequest(`/api/v1/admin/people/${id}`)
export const personAction = (id, action, reason) =>
  apiRequest(`/api/v1/admin/people/${id}/${action}`, json('POST', { reason }))
export const getAdminSettings = () => apiRequest('/api/v1/admin/settings')
export const saveAdminSettings = (changes) => apiRequest('/api/v1/admin/settings', json('PUT', changes))
export const listStaffThreads = (status = 'open') => apiRequest(`/api/v1/admin/support/threads?status=${status}`)
export const getStaffThread = (id) => apiRequest(`/api/v1/admin/support/threads/${id}`)
export const sendStaffMessage = (id, body) =>
  apiRequest(`/api/v1/admin/support/threads/${id}/messages`, json('POST', { body }))
export const setThreadStatus = (id, status) =>
  apiRequest(`/api/v1/admin/support/threads/${id}/status`, json('POST', { status }))
export const listLoadRequests = (status = 'quote_requested') =>
  apiRequest(`/api/v1/admin/haulage-requests?status=${status}`)
export const sendLoadQuote = (id, amount, terms) =>
  apiRequest(`/api/v1/admin/haulage-requests/${id}/quote`, json('POST', { amount: String(amount), terms }))
