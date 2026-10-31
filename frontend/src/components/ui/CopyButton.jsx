import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button type="button" className="copy-btn row" style={{ gap: 6 }} onClick={copy} aria-label={`Copy ${label}`}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
