// Kept in step with app/onboarding.py (the server checks everything again).
export const REVIEW_HOURS = 72
export const MIN_DRIVER_AGE = 18
export const LICENCE_VEHICLES = ['car', 'minibus', 'big_car', 'van', 'dyna']

export const SAFETY_PLEDGES = [
  ['documents', 'I hold a valid licence and will carry my licence and vehicle papers on every trip.'],
  ['sober', 'I will never drive after drinking alcohol or taking drugs.'],
  ['protection', 'On a motorcycle, my passenger and I will wear helmets. In a car, everyone wears a seat belt.'],
  ['road_rules', "I will obey speed limits and traffic rules, and won't use my phone while moving."],
  ['respect', 'I will treat every passenger with respect. No harassment, threats or overcharging.'],
  ['roadworthy', 'I will keep my vehicle roadworthy and bring it for inspection when EkiMove asks.'],
]

export const TOWNS = [
  'Ado-Ekiti', 'Iworoko', 'Ikere-Ekiti', 'Iyin-Ekiti', 'Igede-Ekiti', 'Ifaki-Ekiti', 'Are-Ekiti', 'Afao-Ekiti',
  'Ilawe-Ekiti', 'Igbara-Odo', 'Ijero-Ekiti', 'Ikole-Ekiti', 'Ido-Ekiti', 'Efon-Alaaye', 'Aramoko-Ekiti',
]

export const INVITE_KINDS = {
  inspection: 'Vehicle inspection',
  orientation: 'App orientation',
  both: 'Inspection + orientation',
}

/** The latest date of birth that makes someone 18 today, as YYYY-MM-DD. */
export function latestBirthDate() {
  const today = new Date()
  const d = new Date(today.getFullYear() - MIN_DRIVER_AGE, today.getMonth(), today.getDate())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function needsLicence(vehicleType) {
  return LICENCE_VEHICLES.includes(vehicleType)
}

/** Check the details part of a FormData; returns a message or ''. */
export function detailsProblem(form, { vehicleType, ownPhone } = {}) {
  if (!form.get('gender')) return 'Choose your gender.'
  const dob = String(form.get('date_of_birth') || '')
  if (!dob) return 'Enter your date of birth.'
  if (dob > latestBirthDate()) return `You must be at least ${MIN_DRIVER_AGE} years old to drive with EkiMove.`
  if (String(form.get('home_address') || '').trim().length < 8) return 'Enter your home address (house number, street and area).'
  if (String(form.get('town') || '').trim().length < 2) return 'Enter the town you live in.'
  if (needsLicence(vehicleType) && !String(form.get('licence_number') || '').trim()) {
    return "Enter your driver's licence number. It's required for cars, buses and trucks."
  }
  if (String(form.get('emergency_contact_name') || '').trim().length < 2) return "Enter your emergency contact's name."
  const contact = String(form.get('emergency_contact_phone') || '').replace(/\D/g, '')
  if (contact.length < 10) return 'Enter a phone number for your emergency contact.'
  if (ownPhone && contact.slice(-10) === String(ownPhone).replace(/\D/g, '').slice(-10)) {
    return 'Your emergency contact needs a different phone number from yours.'
  }
  const ticked = form.getAll('safety_pledges')
  if (SAFETY_PLEDGES.some(([key]) => !ticked.includes(key))) return 'Tick every safety promise to continue.'
  return ''
}
