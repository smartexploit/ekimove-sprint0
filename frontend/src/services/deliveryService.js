import { apiRequest } from './authService.js'
import { isPin, stopOf } from '../utils/stops.js'

export const getDeliveryOptions = (originId, destinationId) => (isPin(originId) || isPin(destinationId)
  ? apiRequest('/api/v1/point-delivery-options', {
    method: 'POST', body: JSON.stringify({ origin: stopOf(originId), destination: stopOf(destinationId) }),
  })
  : apiRequest(`/api/v1/delivery-options?origin_place_id=${originId}&destination_place_id=${destinationId}`))
export const createDelivery = (payload) =>
  apiRequest('/api/v1/deliveries', { method: 'POST', body: JSON.stringify(payload) })
export const markDelivered = (rideId, reason) =>
  apiRequest(`/api/v1/admin/rides/${rideId}/mark-delivered`, { method: 'POST', body: JSON.stringify({ reason }) })
