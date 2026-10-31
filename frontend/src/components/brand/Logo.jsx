import { Link } from 'react-router-dom'

const ROAD = 'M14 110 C 44 104, 38 80, 60 72 C 78 65, 82 50, 90 40'

/**
 * The EkiMove mark: two Ekiti hills, a red-earth road climbing over them
 * and a rising harmattan sun. `reversed` is for dark backgrounds.
 */
export function LogoMark({ size = 40, reversed = false, title }) {
  const labelled = Boolean(title)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <path d="M6 96 C 22 50, 52 46, 72 96 Z" fill="#2E8B63" />
      <path
        d="M38 96 C 58 32, 98 32, 116 96 Z"
        fill={reversed ? '#DCEBE3' : '#0E4D3B'}
      />
      <path
        d={ROAD}
        fill="none"
        stroke={reversed ? '#D9643A' : '#B94A28'}
        strokeWidth={size < 32 ? 15 : 11}
        strokeLinecap="round"
      />
      {!reversed && size >= 48 && (
        <path
          d={ROAD}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="4 7"
        />
      )}
      <circle cx="99" cy="23" r={size < 32 ? 13 : 10} fill="#F2B33D" />
    </svg>
  )
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`brand-word ${className}`.trim()}>
      Eki<span className="brand-word-accent">Move</span>
    </span>
  )
}

/** Mark + wordmark lockup that links home. */
export default function Logo({
  to = '/',
  reversed = false,
  size = 40,
  onClick,
  label = 'EkiMove home',
}) {
  return (
    <Link
      to={to}
      className={`brand ${reversed ? 'brand-light' : ''}`.trim()}
      aria-label={label}
      onClick={onClick}
    >
      <LogoMark size={size} reversed={reversed} />
      <Wordmark />
    </Link>
  )
}
