/**
 * Layered Ekiti hills used along the bottom of dark brand panels.
 * `base` is the colour of whatever sits directly below the panel, so the
 * last hill blends into it.
 */
export default function Hills({ base = '#F2F5F1', className = 'hills' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 220"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 150 C 160 70, 300 70, 470 140 C 600 60, 760 40, 900 130 C 1040 70, 1220 60, 1440 120 L 1440 220 L 0 220 Z"
        fill="#1A6B50"
      />
      <path
        d="M0 190 C 200 120, 380 130, 560 180 C 720 110, 920 110, 1080 170 C 1220 130, 1340 130, 1440 160 L 1440 220 L 0 220 Z"
        fill="#2E8B63"
      />
      <path
        d="M0 210 C 300 175, 600 175, 820 200 C 1040 180, 1260 178, 1440 196 L 1440 220 L 0 220 Z"
        fill={base}
      />
    </svg>
  )
}
