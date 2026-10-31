import { apiRequest } from './authService.js'

export const getCurrentOffer = () => apiRequest('/api/v1/driver/offers/current')
export const acceptOffer = (id) => apiRequest(`/api/v1/driver/offers/${id}/accept`, { method: 'POST' })
export const declineOffer = (id) => apiRequest(`/api/v1/driver/offers/${id}/decline`, { method: 'POST' })
export const shareLocation = (latitude, longitude) =>
  apiRequest('/api/v1/driver/location', { method: 'POST', body: JSON.stringify({ latitude, longitude }) })

export const TRIPS_CHANGED_EVENT = 'ekimove:trips-changed'
