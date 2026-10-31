import { apiRequest } from './authService.js'

const json = (method, body) => ({ method, body: JSON.stringify(body) })

export const getTracking = (rideId) => apiRequest(`/api/v1/rides/${rideId}/tracking`)
export const shareTrip = (rideId) => apiRequest(`/api/v1/rides/${rideId}/share`, { method: 'POST' })
export const stopSharingTrip = (rideId) => apiRequest(`/api/v1/rides/${rideId}/share`, { method: 'DELETE' })
export const getSharedTrip = (token) => apiRequest(`/api/v1/share/${encodeURIComponent(token)}`)
export const rateTrip = (rideId, score, comment) =>
  apiRequest(`/api/v1/rides/${rideId}/rating`, json('POST', { score, ...(comment ? { comment } : {}) }))
export const getReceipt = (rideId) => apiRequest(`/api/v1/rides/${rideId}/receipt`)
export const getMapConfig = () => apiRequest('/api/v1/map-config')

// Verification, emergency contact, policies
export const getMyVerification = () => apiRequest('/api/v1/me/verification')
export const submitVerification = (formData) =>
  apiRequest('/api/v1/me/verification', { method: 'POST', body: formData })
export const saveEmergencyContact = (name, phone) =>
  apiRequest('/api/v1/me/emergency-contact', json('PUT', { name, phone }))
export const getPolicyStatus = () => apiRequest('/api/v1/policies/status')
export const acceptPolicies = (version) => apiRequest('/api/v1/policies/accept', json('POST', { version }))

// Admin
export const getLiveMap = () => apiRequest('/api/v1/admin/live-map')
export const getRideTrail = (rideId) => apiRequest(`/api/v1/admin/rides/${rideId}/trail`)
export const listVerifications = (status = 'pending') => apiRequest(`/api/v1/admin/verifications?status=${status}`)
export const reviewVerification = (userId, decision, note) =>
  apiRequest(`/api/v1/admin/verifications/${userId}/review`, json('POST', { decision, ...(note ? { note } : {}) }))
