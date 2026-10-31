import { apiRequest } from './authService.js'

const json = (method, body) => ({ method, body: JSON.stringify(body) })

export const getMyPromos = () => apiRequest('/api/v1/me/promos')
export const checkPromo = (code, fare) => apiRequest('/api/v1/promos/check', json('POST', { code, fare: String(fare) }))
export const listSavedPlaces = () => apiRequest('/api/v1/me/saved-places')
export const savePlace = (label, placeId) => apiRequest('/api/v1/me/saved-places', json('POST', { label, place_id: placeId }))
export const deleteSavedPlace = (id) => apiRequest(`/api/v1/me/saved-places/${id}`, { method: 'DELETE' })

// Trip chat
export const getTripMessages = (rideId) => apiRequest(`/api/v1/rides/${rideId}/messages`)
export const sendTripMessage = (rideId, body) => apiRequest(`/api/v1/rides/${rideId}/messages`, json('POST', { body }))

// Data rights
export const requestDeletion = (password, reason) =>
  apiRequest('/api/v1/me/deletion-request', json('POST', { password, reason: reason || null }))
export const cancelDeletion = () => apiRequest('/api/v1/me/deletion-request', { method: 'DELETE' })

// Admin
export const listAdminPromos = () => apiRequest('/api/v1/admin/promos')
export const createPromo = (payload) => apiRequest('/api/v1/admin/promos', json('POST', payload))
export const setPromoActive = (id, isActive) => apiRequest(`/api/v1/admin/promos/${id}`, json('PATCH', { is_active: isActive }))
