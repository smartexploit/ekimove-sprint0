import { ShieldCheck } from 'lucide-react'
import { nameTyping, phoneTyping } from '../../utils/inputRules.js'
import { SAFETY_PLEDGES, TOWNS, latestBirthDate, needsLicence } from '../../utils/driverOnboarding.js'

const filterWith = (rule) => (event) => {
  const cleaned = rule(event.target.value)
  if (cleaned !== event.target.value) event.target.value = cleaned
}
const licenceTyping = (value) => value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)
const fieldset = { border: 0, margin: 0, padding: 0, minWidth: 0 }

/**
 * Personal details, licence, emergency contact and safety promises for a
 * driver application. Uncontrolled inputs, read from the form's FormData.
 */
export default function DriverDetailsFields({ vehicleType, initial = {}, idPrefix = 'dd' }) {
  const licenceRequired = needsLicence(vehicleType)
  const id = (name) => `${idPrefix}-${name}`
  return (
    <>
      <fieldset className="stack" style={fieldset}>
        <legend className="section-title" style={{ marginBottom: 14 }}>Personal details</legend>
        <div className="form-grid">
          <label className="field" htmlFor={id('gender')}>
            <span className="field-label">Gender</span>
            <select id={id('gender')} className="select" name="gender" defaultValue={initial.gender || ''} required>
              <option value="" disabled>Choose…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label className="field" htmlFor={id('dob')}>
            <span className="field-label">Date of birth</span>
            <input id={id('dob')} className="input" name="date_of_birth" type="date" max={latestBirthDate()}
              min="1950-01-01" defaultValue={initial.date_of_birth || ''} aria-describedby={id('dob-hint')} required />
            <span className="field-hint" id={id('dob-hint')}>You must be 18 or older.</span>
          </label>
        </div>
        <label className="field" htmlFor={id('address')}>
          <span className="field-label">Home address</span>
          <input id={id('address')} className="input" name="home_address" autoComplete="street-address" minLength={8}
            maxLength={240} placeholder="e.g. 12 Ajilosun Street, off Iyin Road" defaultValue={initial.home_address || ''}
            required />
        </label>
        <div className="form-grid">
          <label className="field" htmlFor={id('town')}>
            <span className="field-label">Town</span>
            <input id={id('town')} className="input" name="town" list={id('towns')} autoComplete="address-level2"
              minLength={2} maxLength={80} placeholder="e.g. Ado-Ekiti" defaultValue={initial.town || ''} required />
            <datalist id={id('towns')}>
              {TOWNS.map((town) => <option key={town} value={town} />)}
            </datalist>
          </label>
          <label className="field" htmlFor={id('licence')}>
            <span className="field-label">Driver’s licence number{licenceRequired ? '' : ' (optional)'}</span>
            <input id={id('licence')} className="input" name="licence_number" autoCapitalize="characters"
              spellCheck={false} maxLength={20} placeholder="As printed on your licence"
              defaultValue={initial.licence_number || ''} required={licenceRequired}
              onInput={filterWith(licenceTyping)} aria-describedby={id('licence-hint')} />
            <span className="field-hint" id={id('licence-hint')}>
              {licenceRequired
                ? 'Required for cars, buses and trucks. Bring the licence to your inspection.'
                : 'Add it if you have one; we may ask to see it.'}
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="stack" style={fieldset}>
        <legend className="section-title" style={{ marginBottom: 6 }}>Emergency contact</legend>
        <p className="muted small" style={{ marginBottom: 8 }}>
          Someone we can call if you’re in an accident or can’t be reached during a trip.
        </p>
        <div className="form-grid">
          <label className="field" htmlFor={id('ec-name')}>
            <span className="field-label">Their full name</span>
            <input id={id('ec-name')} className="input" name="emergency_contact_name" minLength={2} maxLength={80}
              defaultValue={initial.emergency_contact_name || ''} onInput={filterWith(nameTyping)} required />
          </label>
          <label className="field" htmlFor={id('ec-phone')}>
            <span className="field-label">Their phone number</span>
            <input id={id('ec-phone')} className="input" name="emergency_contact_phone" type="tel" inputMode="tel"
              minLength={10} maxLength={18} placeholder="e.g. 0803 123 4567"
              defaultValue={initial.emergency_contact_phone || ''} onInput={filterWith(phoneTyping)} required />
          </label>
        </div>
      </fieldset>

      <fieldset className="stack stack-sm pledge-box" style={fieldset}>
        <legend className="section-title" style={{ marginBottom: 6 }}>
          <ShieldCheck size={18} aria-hidden="true" /> Safety promises
        </legend>
        <p className="muted small">Tick each one. Breaking them can lead to suspension.</p>
        {SAFETY_PLEDGES.map(([key, text]) => (
          <label className="check-row" key={key}>
            <input type="checkbox" name="safety_pledges" value={key} required
              defaultChecked={Boolean(initial.safety_pledged_at)} />
            <span>{text}</span>
          </label>
        ))}
      </fieldset>
    </>
  )
}
