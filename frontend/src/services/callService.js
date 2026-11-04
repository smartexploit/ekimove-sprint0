import { apiRequest } from './authService.js'

const post = (path, body) => apiRequest(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) })

let config = null
export function getCallConfig() {
  if (!config) config = apiRequest('/api/v1/calls/config').catch((error) => {
    config = null
    throw error
  })
  return config
}

export const startTripCall = (rideId) => post(`/api/v1/rides/${rideId}/calls`)
export const getIncomingCall = () => apiRequest('/api/v1/calls/incoming')
export const getCallState = (callId, after = 0) => apiRequest(`/api/v1/calls/${callId}?after=${after}`)
export const sendCallSignal = (callId, kind, payload) =>
  post(`/api/v1/calls/${callId}/signal`, { kind, payload: JSON.stringify(payload) })
export const acceptCall = (callId) => post(`/api/v1/calls/${callId}/accept`)
export const declineCall = (callId) => post(`/api/v1/calls/${callId}/decline`)
export const endCall = (callId, failed = false) => post(`/api/v1/calls/${callId}/end`, { failed })
