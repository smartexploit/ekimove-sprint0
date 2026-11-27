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

export const LATEST_YEAR = new Date().getFullYear() + 1
export const OLDEST_YEAR = 1980

/** Why the vehicle details can't be sent yet, or ''. Used by the application form and the driver status page. */
export function vehicleDetailsProblem(form, { photoRequired = true } = {}) {
  const model = String(form.get('make_model') || '').trim()
  const year = Number(form.get('year'))
  const colour = String(form.get('color') || '').trim()
  const photo = form.get('vehicle_photo')
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,'()/&-]{1,79}$/.test(model)) return 'Enter the make and model, like Toyota Corolla or Bajaj Boxer.'
  if (!Number.isInteger(year) || year < OLDEST_YEAR || year > LATEST_YEAR) return `Enter the year the vehicle was made, between ${OLDEST_YEAR} and ${LATEST_YEAR}.`
  if (!/^[A-Za-z][A-Za-z /-]{1,39}$/.test(colour)) return 'Enter the vehicle’s colour, like Silver or Black.'
  if (photoRequired && !(photo && photo.size)) return 'Add a clear photo of the vehicle.'
  if (photo && photo.size > 5 * 1024 * 1024) return 'The vehicle photo must be no larger than 5 MB.'
  return ''
}

/** How passengers spot a vehicle, e.g. "Silver Toyota Corolla (2012)"; '' when not given yet. */
export function vehicleName(vehicle) {
  if (!vehicle?.make_model) return vehicle?.vehicle_name || ''
  const name = vehicle.color ? `${vehicle.color} ${vehicle.make_model}` : vehicle.make_model
  return vehicle.year ? `${name} (${vehicle.year})` : name
}
