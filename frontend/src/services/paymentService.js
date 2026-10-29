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


export async function initiateInterswitchPayment(rideId, customerEmail) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/interswitch/initiate`, {
    method: 'POST',
    body: JSON.stringify({ customer_email: customerEmail.trim() }),
  })
}

export async function verifyInterswitchPayment(rideId) {
  return apiRequest(`/api/v1/payments/rides/${rideId}/interswitch/verify`, {
    method: 'POST',
  })
}
