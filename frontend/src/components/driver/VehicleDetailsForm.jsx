import { useState } from 'react'
import Alert from '../ui/Alert.jsx'
import { apiRequest } from '../../services/authService.js'
import { LATEST_YEAR, OLDEST_YEAR, vehicleDetailsProblem, vehicleGroup } from '../../utils/vehicles.js'

const MODEL_EXAMPLES = {
  motorcycle: 'e.g. Bajaj Boxer', car: 'e.g. Toyota Corolla', moving: 'e.g. Toyota Hiace', bus: 'e.g. Toyota Coaster',
}

/** Add a vehicle's make and model, year, colour and photo (for drivers who applied before these were asked for). */
export default function VehicleDetailsForm({ vehicle, onSaved }) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const id = `vehicle-${vehicle.id}`

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const problem = vehicleDetailsProblem(form, { photoRequired: !vehicle.photo_available })
    if (problem) {
      setError(problem)
      return
    }
    form.set('make_model', String(form.get('make_model')).trim().replace(/\s+/g, ' '))
    form.set('color', String(form.get('color')).trim().replace(/\s+/g, ' '))
    if (!form.get('vehicle_photo')?.size) form.delete('vehicle_photo')
    setError('')
    setSaving(true)
    try {
      const saved = await apiRequest(`/api/v1/driver-applications/me/vehicles/${vehicle.id}/details`, {
        method: 'POST',
        body: form,
      })
      onSaved(saved)
    } catch (err) {
      setError(err.message || 'Could not save your vehicle details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form stack stack-sm" onSubmit={submit} encType="multipart/form-data">
      <p className="small" style={{ fontWeight: 700 }}>Add your vehicle details</p>
      <p className="muted small">We now ask every driver for these, so passengers can spot your vehicle.</p>
      <div className="form-grid">
        <label className="field" htmlFor={`${id}-model`}>
          <span className="field-label">Make and model</span>
          <input id={`${id}-model`} className="input" name="make_model" maxLength={80} required
            defaultValue={vehicle.make_model || ''} placeholder={MODEL_EXAMPLES[vehicleGroup(vehicle.vehicle_type)] || 'e.g. Toyota Corolla'} autoCapitalize="words" />
        </label>
        <label className="field" htmlFor={`${id}-year`}>
          <span className="field-label">Year</span>
          <input id={`${id}-year`} className="input" name="year" type="number" inputMode="numeric" required
            min={OLDEST_YEAR} max={LATEST_YEAR} defaultValue={vehicle.year || ''} placeholder="e.g. 2012" />
        </label>
        <label className="field" htmlFor={`${id}-colour`}>
          <span className="field-label">Colour</span>
          <input id={`${id}-colour`} className="input" name="color" maxLength={40} required
            defaultValue={vehicle.color || ''} placeholder="e.g. Silver" autoCapitalize="words" />
        </label>
      </div>
      <label className="field" htmlFor={`${id}-photo`}>
        <span className="field-label">Vehicle photo{vehicle.photo_available ? ' (optional: replaces the one we have)' : ''}</span>
        <input id={`${id}-photo`} className="input" name="vehicle_photo" type="file"
          accept="image/jpeg,image/png,image/webp" required={!vehicle.photo_available} />
        <span className="field-hint">The whole vehicle with the plate number showing. Up to 5 MB.</span>
      </label>
      <Alert tone="error">{error}</Alert>
      <div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save vehicle details'}
        </button>
      </div>
    </form>
  )
}
