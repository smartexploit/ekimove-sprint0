import { useCallback, useEffect, useRef, useState } from 'react'

// Phones and small tablets: the Atọ́nà button floats, can be dragged up or
// down either edge, snaps to the nearest side, and remembers where it was
// left. It hides while the on-screen keyboard is up so it never sits on a
// field someone is typing in, and when it would cover a button or link it
// moves to the other side, or tucks into the screen edge if both are busy.
const KEY = 'ekimove_atona_position'
const FLOAT_QUERY = '(max-width: 760px)'
const MARGIN = 12
const DRAG_START = 6
const SIZE = 56
const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])'

/**
 * Would a button placed here hide something people tap? Only small targets
 * count (an eye icon, a link, a checkbox): a wide card or field with just a
 * corner under the button can still be tapped everywhere else.
 */
function blocked(left, top) {
  const points = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]
  const seen = new Set()
  for (const [fx, fy] of points) {
    for (const el of document.elementsFromPoint(left + SIZE * fx, top + SIZE * fy)) {
      if (el.closest('.atona-widget, .tabbar, .app-topbar, .site-header')) continue
      const target = el.closest(INTERACTIVE)
      if (!target || seen.has(target)) continue
      seen.add(target)
      const r = target.getBoundingClientRect()
      const overlapW = Math.min(r.right, left + SIZE) - Math.max(r.left, left)
      const overlapH = Math.min(r.bottom, top + SIZE) - Math.max(r.top, top)
      if (overlapW <= 0 || overlapH <= 0) continue
      const cx = (r.left + r.right) / 2
      const cy = (r.top + r.bottom) / 2
      const centreHidden = cx >= left - 4 && cx <= left + SIZE + 4 && cy >= top - 4 && cy <= top + SIZE + 4
      const share = (overlapW * overlapH) / Math.max(1, r.width * r.height)
      if (centreHidden || share > 0.4) return true
    }
  }
  return false
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && (saved.side === 'left' || saved.side === 'right') && Number.isFinite(saved.bottom)) return saved
  } catch {
    /* storage unavailable */
  }
  return null
}

function save(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/** Space the button must keep clear of: the tab bar below, the header above. */
function limits(size) {
  const tabbar = document.querySelector('.tabbar')
  const tabbarHeight = tabbar && getComputedStyle(tabbar).display !== 'none' ? tabbar.getBoundingClientRect().height : 0
  const header = document.querySelector('.app-topbar, .site-header')
  const headerHeight = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0
  const min = Math.round(tabbarHeight + MARGIN)
  const max = Math.round(window.innerHeight - headerHeight - size - MARGIN)
  return { min, max: Math.max(min, max) }
}

export default function useLauncherPosition(widgetRef, open) {
  const [floating, setFloating] = useState(() => window.matchMedia?.(FLOAT_QUERY).matches ?? false)
  const [position, setPosition] = useState(readSaved)
  const [typing, setTyping] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [avoid, setAvoid] = useState(null)
  const drag = useRef(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const query = window.matchMedia?.(FLOAT_QUERY)
    if (!query) return undefined
    const update = () => setFloating(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  // Keep a saved position on screen when the window size changes.
  useEffect(() => {
    if (!floating) return undefined
    function clamp() {
      setPosition((current) => {
        if (!current) return current
        const { min, max } = limits(widgetRef.current?.offsetHeight || 56)
        const bottom = Math.min(Math.max(current.bottom, min), max)
        return bottom === current.bottom ? current : { ...current, bottom }
      })
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [floating, widgetRef])

  // Out of the way while the keyboard is up.
  useEffect(() => {
    if (!floating) return undefined
    const isField = (el) => el instanceof HTMLElement && !el.closest('.atona-widget')
      && (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select')
        || el.isContentEditable)
    const onIn = (event) => setTyping(isField(event.target))
    const onOut = () => setTyping(false)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [floating])

  // Pointer moves are followed on the window, so a quick drag that leaves
  // the button straight away still moves it.
  // Step aside from whatever is under the button once scrolling settles.
  useEffect(() => {
    if (!floating || open || dragging) return undefined
    let timer = 0
    function evaluate() {
      const widget = widgetRef.current
      if (!widget) return
      const bottom = parseFloat(getComputedStyle(widget).bottom) || 0
      const side = position?.side || 'right'
      const top = window.innerHeight - bottom - SIZE
      const here = side === 'right' ? window.innerWidth - MARGIN - SIZE : MARGIN
      const there = side === 'right' ? MARGIN : window.innerWidth - MARGIN - SIZE
      let next = null
      if (blocked(here, top)) next = blocked(there, top) ? 'tuck' : 'flip'
      setAvoid((current) => (current === next ? current : next))
    }
    // Checked on every animation frame while scrolling, so the button is
    // already out of the way when the page comes to rest.
    const later = () => {
      if (timer) return
      timer = window.requestAnimationFrame(() => {
        timer = 0
        evaluate()
      })
    }
    evaluate()
    const poll = window.setInterval(evaluate, 1000)
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      window.cancelAnimationFrame(timer)
      window.clearInterval(poll)
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
    }
  }, [floating, open, dragging, position, widgetRef])

  const onPointerDown = useCallback((event) => {
    if (!floating || event.button > 0) return
    const widget = widgetRef.current
    const state = { x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId }
    drag.current = state

    function move(e) {
      if (e.pointerId !== state.pointer) return
      const dx = e.clientX - state.x
      const dy = e.clientY - state.y
      if (!state.moved && Math.hypot(dx, dy) < DRAG_START) return
      if (!state.moved) {
        state.moved = true
        setDragging(true)
      }
      e.preventDefault()
      widget.style.transform = `translate(${dx}px, ${dy}px)`
    }
    function finish(e, cancelled) {
      if (e.pointerId !== state.pointer) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      drag.current = null
      if (!state.moved) return
      const rect = widget.getBoundingClientRect()
      widget.style.transform = ''
      setDragging(false)
      if (cancelled) return
      suppressClick.current = true
      const { min, max } = limits(rect.height)
      const centre = rect.left + rect.width / 2
      const next = {
        side: centre < window.innerWidth / 2 ? 'left' : 'right',
        bottom: Math.round(Math.min(Math.max(window.innerHeight - rect.bottom, min), max)),
      }
      setPosition(next)
      save(next)
      // A drag that ends off the button fires no click to swallow.
      window.setTimeout(() => { suppressClick.current = false }, 400)
    }
    const up = (e) => finish(e, false)
    const cancel = (e) => finish(e, true)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [floating, widgetRef])

  /** Swallow the click that ends a drag, so dropping the button doesn't open the chat. */
  const onClickCapture = useCallback((event) => {
    if (suppressClick.current) {
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const savedSide = position?.side || 'right'
  const side = avoid === 'flip' ? (savedSide === 'right' ? 'left' : 'right') : savedSide
  const placed = floating && !open && (position || avoid === 'flip')
  const style = placed
    ? {
      ...(position ? { bottom: `${position.bottom}px` } : {}),
      [side]: `${MARGIN}px`,
      [side === 'left' ? 'right' : 'left']: 'auto',
    }
    : undefined

  return {
    style,
    hidden: floating && !open && typing,
    tucked: floating && !open && !dragging && avoid === 'tuck' ? side : null,
    dragging,
    handlers: floating ? { onPointerDown, onClickCapture } : {},
  }
}
