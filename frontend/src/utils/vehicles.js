import { isMotorcycle, titleCase } from './format.js'

const LOAD_VEHICLES = { big_car: 'Big car', van: 'Van or bus', dyna: 'Dyna truck' }

export function vehicleLabel(type) {
  if (isMotorcycle(type)) return 'Motorcycle'
  if (LOAD_VEHICLES[type]) return LOAD_VEHICLES[type]
  if (type === 'bus') return 'Travel bus'
  return titleCase(type) || 'Vehicle'
}

export function vehicleBlurb(type) {
  const value = String(type || '').toLowerCase()
  if (isMotorcycle(value)) return '1 passenger · quickest through town'
  if (value === 'car') return 'More room and comfort'
  if (value === 'tricycle') return 'Shared, budget-friendly'
  if (['minibus', 'bus', 'van'].includes(value)) return 'For groups'
  return 'Available for this route'
}

// What a driver can register (kept in step with app/driver_applications.py).
export const MOVING_VEHICLES = [
  ['big_car', 'Big car (SUV / Sienna)', 6],
  ['van', 'Van or bus', 8],
  ['dyna', 'Dyna truck', 2],
]
// Travel buses carry students on long trips with seats booked ahead; they never get town rides.
export const SEAT_LIMITS = { motorcycle: 2, car: 4, ...Object.fromEntries(MOVING_VEHICLES.map(([v, , n]) => [v, n])), bus: 60 }
export const DRIVER_VEHICLE_TYPES = Object.keys(SEAT_LIMITS)

/** 'motorcycle', 'car', 'moving', 'bus' or 'other' (older records, e.g. tricycle). */
export function vehicleGroup(type) {
  const value = String(type || '').toLowerCase()
  if (isMotorcycle(value)) return 'motorcycle'
  if (value === 'car') return 'car'
  if (MOVING_VEHICLES.some(([v]) => v === value)) return 'moving'
  if (value === 'bus') return 'bus'
  return 'other'
}
