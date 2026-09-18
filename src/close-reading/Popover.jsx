import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VIEWPORT_PAD = 8

// 锚定到某个矩形的浮动弹层；getAnchorRect 可返回实时矩形（Range/Element），
// 滚动、缩放时自动重定位，超出视口自动换边与钳制
export default function Popover({ getAnchorRect, anchorRect, placement = 'top', onClose, children, labelledBy, maxWidth = 380 }) {
  const panelRef = useRef(null)
  const [coords, setCoords] = useState(null)
  const [actualPlacement, setActualPlacement] = useState(placement)

  const resolveRect = () => {
    if (typeof getAnchorRect === 'function') { try { return getAnchorRect() } catch { return null } }
    return anchorRect
  }

  const reposition = () => {
    const panel = panelRef.current
    const rect = resolveRect()
    if (!panel || !rect) return
    const own = panel.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    let place = placement
    if (place === 'top' && rect.top - own.height - 10 < VIEWPORT_PAD &&
        rect.bottom + 10 + own.height < vh - VIEWPORT_PAD) {
      place = 'bottom'
    }
    if (place === 'bottom' && rect.bottom + own.height + 10 > vh - VIEWPORT_PAD &&
        rect.top - 10 - own.height > VIEWPORT_PAD) {
      place = 'top'
    }
    let left = rect.left + rect.width / 2 - own.width / 2
    left = Math.max(VIEWPORT_PAD, Math.min(left, vw - own.width - VIEWPORT_PAD))
    let top
    if (place === 'top') top = rect.top - own.height - 10
    else if (place === 'bottom') top = rect.bottom + 10
    else top = rect.top + rect.height / 2 - own.height / 2
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - own.height - VIEWPORT_PAD))
    setActualPlacement(place)
    setCoords({ left, top })
  }

  useLayoutEffect(() => { reposition() })

  useEffect(() => {
    let raf = 0
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(reposition) }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove) }
  })

  // Esc 关闭；焦点限制在弹层内
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')
      if (!focusables.length) return
      const first = focusables[0], last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const initial = resolveRect()
  if (!initial) return null
  return createPortal(
    <div
      ref={panelRef}
      className={`cr-popover cr-pop-${actualPlacement}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      style={{ left: coords?.left ?? -9999, top: coords?.top ?? -9999, maxWidth: `min(${maxWidth}px, calc(100vw - 16px))` }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}
