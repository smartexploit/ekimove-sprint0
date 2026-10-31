const ACTIVE = new Set([
  'requested',
  'assigned',
  'driver_arriving',
  'in_progress',
  'incident_review',
])

/** The most specific status for a passenger ride request. */
export function rideStatus(ride) {
  return ride?.ride_status || ride?.status || ''
}

export function isActiveRide(ride) {
  return ACTIVE.has(rideStatus(ride))
}

/** Progress steps shown on the live ride card. */
export const PROGRESS_STEPS = [
  ['requested', 'Requested'],
  ['assigned', 'Assigned'],
  ['driver_arriving', 'Arriving'],
  ['in_progress', 'On the way'],
]

export function progressIndex(status) {
  if (status === 'completed') return PROGRESS_STEPS.length
  const index = PROGRESS_STEPS.findIndex(([key]) => key === status)
  return index === -1 ? 0 : index
}
