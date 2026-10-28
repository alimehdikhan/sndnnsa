import { useLayoutEffect, useRef, useState } from 'react'
import { easeOut, isRapid, useReducedMotion } from '@/lib/motion'

const DURATION_MS = 420

/**
 * A number that counts to its new value instead of jumping, writing straight to the
 * DOM each frame so nothing else re-renders. An interrupted count restarts from the
 * value on screen, not the old target, so quick changes never jump backwards. Screen
 * readers get the final value only.
 */
export function AnimatedNumber({ value, format, className }: { value: number | null; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const onScreen = useRef<number | null>(value)
  const reduced = useReducedMotion()
  const final = value === null ? '—' : format(value)
  const [initial] = useState(final)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const from = onScreen.current
    if (value === null || from === null || from === value || reduced || isRapid()) {
      onScreen.current = value
      el.textContent = final
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      const current = t === 1 ? value : from + (value - from) * easeOut(t)
      onScreen.current = current
      el.textContent = t === 1 ? final : format(current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, final, format, reduced])

  return (
    <>
      <span ref={ref} aria-hidden="true" className={className}>
        {initial}
      </span>
      <span className="sr-only">{final}</span>
    </>
  )
}
