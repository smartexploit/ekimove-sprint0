import { apiRequest } from './authService.js'

export async function initiateRidePayment(rideId) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/initiate`, {
    method: 'POST',
  })
}

export async function submitTransferReference(rideId, transferReference) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/submit-transfer`, {
    method: 'POST',
    body: JSON.stringify({
      transfer_reference: transferReference.trim(),
    }),
  })
}

export async function getRidePayment(rideId) {
  return apiRequest(`/api/v1/payments/rides/${rideId}`)
}
