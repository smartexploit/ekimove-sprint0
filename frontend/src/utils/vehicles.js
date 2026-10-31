import { isMotorcycle, titleCase } from './format.js'

const LOAD_VEHICLES = { big_car: 'Big car', van: 'Van or bus', dyna: 'Dyna truck' }

export function vehicleLabel(type) {
  if (isMotorcycle(type)) return 'Motorcycle'
  if (LOAD_VEHICLES[type]) return LOAD_VEHICLES[type]
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
