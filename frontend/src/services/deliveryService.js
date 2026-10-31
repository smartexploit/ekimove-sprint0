import { apiRequest } from './authService.js'

export const getDeliveryOptions = (originId, destinationId) =>
  apiRequest(`/api/v1/delivery-options?origin_place_id=${originId}&destination_place_id=${destinationId}`)
export const createDelivery = (payload) =>
  apiRequest('/api/v1/deliveries', { method: 'POST', body: JSON.stringify(payload) })
export const markDelivered = (rideId, reason) =>
  apiRequest(`/api/v1/admin/rides/${rideId}/mark-delivered`, { method: 'POST', body: JSON.stringify({ reason }) })
