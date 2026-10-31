import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function PasswordInput({ id, ...inputProps }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="input-affix">
      <input
        id={id}
        className="input"
        type={visible ? 'text' : 'password'}
        {...inputProps}
      />
      <button
        type="button"
        className="input-affix-btn"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={id}
      >
        {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  )
}
