import { useEffect, useState } from 'react'

// Charts and numbers animate between selections, except while selections are
// arriving faster than an animation could finish (a dragged slider, a held arrow key,
// a window being resized). Then they jump, so they never trail behind the input.

const RAPID_MS = 320
let lastChange = -Infinity
let rapid = false

/** Call on every user-driven selection change, before rendering it. */
export function noteSelectionChange(repeat = false): void {
  const now = performance.now()
  rapid = repeat || now - lastChange < RAPID_MS
  lastChange = now
}

/** Whether the selection being rendered arrived mid-burst (read during render). */
export function isRapid(): boolean {
  return rapid || performance.now() - lastResize < RAPID_MS
}

let lastResize = -Infinity
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => (lastResize = performance.now()), { passive: true })
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

const entered = new Set<string>()
const ENTRANCE_MS = 600
const TRANSITION_MS = 380

/**
 * Recharts animation props: a one-time entrance the first time a chart shows data in
 * this session, then a short morph from the previous selection on every change.
 */
export function useChartAnimation(id: string, ready: boolean) {
  const reduced = useReducedMotion()
  const [entering, setEntering] = useState(() => !entered.has(id))
  useEffect(() => {
    if (!ready || !entering) return
    entered.add(id)
    const timer = window.setTimeout(() => setEntering(false), ENTRANCE_MS + 100)
    return () => window.clearTimeout(timer)
  }, [ready, entering, id])
  if (reduced) return { isAnimationActive: false } as const
  if (entering) return { isAnimationActive: true, animationDuration: ENTRANCE_MS, animationEasing: 'ease-out' } as const
  return { isAnimationActive: !isRapid(), animationDuration: TRANSITION_MS, animationEasing: 'ease-out' } as const
}

/** easeOutCubic: fast start, gentle settle. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3
