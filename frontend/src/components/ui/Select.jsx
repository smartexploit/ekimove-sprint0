import { Children, isValidElement } from 'react'

function optionText(children) {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('')
}

function selectedLabel(children, value) {
  let label = ''
  Children.forEach(children, (child) => {
    if (label || !isValidElement(child) || child.type !== 'option') return
    if (String(child.props.value ?? '') === String(value ?? '')) label = optionText(child.props.children)
  })
  return label
}

/**
 * A native <select> (so phones keep their own picker) laid over a label
 * that wraps long names onto more lines instead of running under the
 * arrow, which iPhone Safari otherwise does.
 */
export default function Select({ className = '', children, value, disabled, ...props }) {
  const label = selectedLabel(children, value)
  return (
    <span
      className={`select-wrap ${disabled ? 'is-disabled' : ''} ${value ? '' : 'is-empty'}`.trim()}
    >
      <span className="select-display" aria-hidden="true">{label}</span>
      <select className={`select select-native ${className}`.trim()} value={value} disabled={disabled} {...props}>
        {children}
      </select>
    </span>
  )
}
