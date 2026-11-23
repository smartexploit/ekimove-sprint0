import { apiRequest } from './authService.js'

const send = (method) => (path, body) =>
  apiRequest(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
const post = send('POST')
const put = send('PUT')

// Students
export const getDepartures = () => apiRequest('/api/v1/travel/departures')
export const bookSeats = (body) => post('/api/v1/travel/bookings', body)
export const getMyTickets = () => apiRequest('/api/v1/travel/bookings')
export const cancelTicket = (id) => post(`/api/v1/travel/bookings/${id}/cancel`)

// Travel desk (staff)
export const adminDepartures = (includePast = false) =>
  apiRequest(`/api/v1/admin/travel/departures${includePast ? '?include_past=true' : ''}`)
export const createDeparture = (body) => post('/api/v1/admin/travel/departures', body)
export const updateDeparture = (id, body) => put(`/api/v1/admin/travel/departures/${id}`, body)
export const setDepartureStatus = (id, status) => post(`/api/v1/admin/travel/departures/${id}/status`, { status })
export const getManifest = (id) => apiRequest(`/api/v1/admin/travel/departures/${id}/manifest`)
export const recordTravelPayment = (bookingId, body) => post(`/api/v1/admin/travel/bookings/${bookingId}/payments`, body)
export const markTravelRefundPaid = (bookingId, reference) =>
  post(`/api/v1/admin/travel/bookings/${bookingId}/refund-paid`, { reference })
export const adminCheckIn = (id, code) => post(`/api/v1/admin/travel/departures/${id}/check-in`, { code })
export const messageTravellers = (id, message) => post(`/api/v1/admin/travel/departures/${id}/message`, { message })
export const getTravelReport = (query) => apiRequest(`/api/v1/admin/travel/report?${query}`)

// Bus drivers
export const getMyBusTrips = () => apiRequest('/api/v1/driver/travel')
export const driverCheckIn = (id, code) => post(`/api/v1/driver/travel/${id}/check-in`, { code })
export const driverTripStatus = (id, status) => post(`/api/v1/driver/travel/${id}/status`, { status })
