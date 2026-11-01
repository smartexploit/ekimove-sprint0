import { useState } from 'react'
import { emailProblem, phoneProblem, phoneTyping } from '../../utils/inputRules.js'

const METHODS = [
  ['phone', 'Phone number'],
  ['email', 'Email'],
]

/** Keep only what an email address is typed with: no spaces, lower case. */
const emailTyping = (value) => value.replace(/[^A-Za-z0-9.@_%+-]/g, '').toLowerCase().slice(0, 254)

/**
 * "Phone number | Email" switch with a field of its own for each, so a
 * phone number only accepts number characters (and is checked as a Nigerian
 * mobile) and an email only accepts email characters. Used on sign-in and
 * password reset.
 */
export default function ContactMethodField({ idPrefix, method, onMethod, phone, onPhone, email, onEmail, label }) {
  const [touched, setTouched] = useState({})
  const problem = method === 'phone' ? phoneProblem(phone) : emailProblem(email)
  const value = method === 'phone' ? phone : email
  const shown = touched[method] && value ? problem : ''
  const fieldId = `${idPrefix}-${method}`

  return (
    <>
      <div className="field">
        <span className="field-label" id={`${idPrefix}-with`}>{label}</span>
        <div className="segmented segmented-block" role="tablist" aria-labelledby={`${idPrefix}-with`}>
          {METHODS.map(([key, text]) => (
            <button key={key} type="button" role="tab" aria-selected={method === key}
              className={method === key ? 'is-active' : ''} onClick={() => onMethod(key)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {method === 'phone' ? (
        <label className="field" htmlFor={fieldId}>
          <span className="field-label">Phone number</span>
          <input
            id={fieldId}
            className="input"
            name="username"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 0803 123 4567"
            value={phone}
            onChange={(event) => onPhone(phoneTyping(event.target.value))}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            minLength={10}
            maxLength={18}
            aria-invalid={Boolean(shown)}
            aria-describedby={`${fieldId}-hint`}
            required
          />
        </label>
      ) : (
        <label className="field" htmlFor={fieldId}>
          <span className="field-label">Email address</span>
          <input
            id={fieldId}
            className="input"
            name="username"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => onEmail(emailTyping(event.target.value))}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            maxLength={254}
            aria-invalid={Boolean(shown)}
            aria-describedby={`${fieldId}-hint`}
            required
          />
        </label>
      )}
      <span id={`${fieldId}-hint`} className={`field-hint ${shown ? 'field-hint-error' : ''}`}
        style={{ marginTop: -8 }} aria-live="polite">
        {shown || (method === 'phone'
          ? 'The Nigerian mobile number on your account. Spaces are fine.'
          : 'The email address on your account.')}
      </span>
    </>
  )
}
