import { useEffect, useState } from 'react'
import { Gift, X } from 'lucide-react'
import { checkPromo } from '../../services/promoService.js'
import { formatNaira } from '../../utils/format.js'

/**
 * Promo code entry. Re-checks the code whenever the fare changes and
 * reports { code, discount } (or null) through onChange.
 */
export default function PromoField({ fare, applied, onChange, suggestions = [] }) {
  const [open, setOpen] = useState(Boolean(applied))
  const [code, setCode] = useState(applied?.code || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const appliedCode = applied?.code

  // A new fare (route, vehicle or passengers changed): check the code again.
  useEffect(() => {
    if (!appliedCode || !fare) return undefined
    let active = true
    Promise.resolve().then(() => checkPromo(appliedCode, fare))
      .then((result) => {
        if (active && result.discount !== applied?.discount) onChange({ code: result.code, discount: result.discount })
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'This code no longer applies.')
        setOpen(true)
        onChange(null)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCode, fare])

  async function apply(value) {
    const clean = (value ?? code).trim()
    if (!clean) return
    if (!fare) {
      setError('Choose your ride first, then apply the code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await checkPromo(clean, fare)
      setCode(result.code)
      onChange({ code: result.code, discount: result.discount })
    } catch (err) {
      setError(err.message || 'This code isn’t valid.')
      onChange(null)
    } finally {
      setBusy(false)
    }
  }

  if (applied) {
    return (
      <div className="promo-applied" role="status">
        <Gift size={18} aria-hidden="true" />
        <span><strong>{applied.code}</strong> · {formatNaira(applied.discount, { decimals: 0 })} off</span>
        <button type="button" className="icon-btn" aria-label="Remove promo code" onClick={() => {
          onChange(null)
          setCode('')
        }}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="stack stack-sm">
      {suggestions.map((item) => (
        <button key={item.code} type="button" className="promo-suggestion" disabled={busy} onClick={() => apply(item.code)}>
          <Gift size={18} aria-hidden="true" />
          <span>
            <strong>{formatNaira(item.value, { decimals: 0 })} off</strong> {item.description ? `· ${item.description}` : ''}
            <span className="muted small" style={{ display: 'block' }}>Tap to use {item.code}</span>
          </span>
        </button>
      ))}
      {!open ? (
        <button type="button" className="link-button link-tap small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          Have a promo code?
        </button>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor="promo-code">Promo code</label>
          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <input id="promo-code" className="input" autoCapitalize="characters" spellCheck={false} maxLength={40}
              value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  apply()
                }
              }} />
            <button type="button" className="btn" disabled={busy || !code.trim()} onClick={() => apply()}>
              {busy ? 'Checking…' : 'Apply'}
            </button>
          </div>
          {error && <span className="field-hint field-hint-error" role="alert">{error}</span>}
        </div>
      )}
    </div>
  )
}
