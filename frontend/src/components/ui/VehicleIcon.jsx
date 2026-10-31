import { Bus, Car, Motorbike, Truck } from 'lucide-react'
import { isMotorcycle } from '../../utils/format.js'

export default function VehicleIcon({ type, size = 26 }) {
  const value = String(type || '').toLowerCase()
  const Icon = isMotorcycle(value)
    ? Motorbike
    : ['minibus', 'bus', 'van'].includes(value)
      ? Bus
      : value === 'tricycle' || value === 'dyna'
        ? Truck
        : Car

  return <Icon size={size} aria-hidden="true" strokeWidth={1.8} />
}
