/** Fired after a booking so the trip guide checks straight away. */
export const TRIP_BOOKED_EVENT = 'ekimove:trip-booked'

/** Which step of the trip a booking is at. */
export function tripStage(trip) {
  if (!trip || trip.service_type === 'haulage') return null  // loads have their own quote steps
  if (trip.status === 'cancelled' || trip.ride_status === 'cancelled') return 'cancelled'
  if (trip.status === 'requested') {
    if (trip.dispatch_status === 'scheduled') return 'scheduled'
    if (trip.dispatch_status === 'manual') return 'manual'
    return 'searching'
  }
  if (trip.ride_status === 'assigned') {
    if (trip.payment_status === 'confirmed') return 'coming'
    if (trip.payment_status === 'awaiting_confirmation') return 'confirming'
    return 'pay'
  }
  if (trip.ride_status === 'driver_arriving') return 'arrived'
  if (trip.ride_status === 'in_progress') return 'onway'
  if (trip.ride_status === 'completed') return trip.my_rating ? 'done' : 'rate'
  return null
}
