import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { GATES, type Gate, type Mode } from '@/lib/api'
import { noteSelectionChange } from '@/lib/motion'

export type Route = '/decision' | '/accuracy'

/** Everything a view shows, mirrored in the URL: /decision?day=2026-01-12&gate=09:50, /accuracy?mode=horizon&h=12 */
export interface ViewState {
  route: Route
  day: string
  decisionGate: Gate
  mode: Mode
  accuracyGate: Gate
  h: number
}

// `day` stays empty until a URL gives one or the snapshot's first day is known (see App).
const DEFAULTS: ViewState = { route: '/decision', day: '', decisionGate: '09:20', mode: 'gate', accuracyGate: '09:20', h: 24 }

/** State from the address bar. Parameters the URL doesn't give keep their current values. */
export function readLocation(current: ViewState = DEFAULTS): ViewState {
  const route: Route = window.location.pathname === '/accuracy' ? '/accuracy' : '/decision'
  const q = new URLSearchParams(window.location.search)
  const day = q.get('day') ?? ''
  const gate = q.get('gate') as Gate
  const validGate = GATES.includes(gate)
  const h = Number(q.get('h'))
  const next = { ...current, route }
  if (route === '/decision') {
    // Range-checked against the snapshot once it loads (App clamps it).
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day))) next.day = day
    if (validGate) next.decisionGate = gate
  } else {
    if (q.get('mode') === 'horizon' || q.get('mode') === 'gate') next.mode = q.get('mode') as Mode
    if (validGate) next.accuracyGate = gate
    if (q.has('h') && Number.isInteger(h) && h >= 0 && h <= 48) next.h = h
  }
  return next
}

export function urlFor(s: ViewState): string {
  const query =
    s.route === '/decision'
      ? new URLSearchParams(s.day ? { day: s.day, gate: s.decisionGate } : { gate: s.decisionGate })
      : new URLSearchParams(s.mode === 'gate' ? { mode: s.mode, gate: s.accuracyGate } : { mode: s.mode, h: String(s.h) })
  return `${s.route}?${query}`
}

/** Push a page change onto the history; the app picks it up from the location. */
export function navigate(to: Route): void {
  if (window.location.pathname === to) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new Event('app:navigate'))
}

/**
 * Two copies of the view state. `live` drives the controls and the URL and changes on
 * the same frame as the input. `shown` drives the charts and follows in a transition:
 * React renders it in the background, keeps the previous view on screen meanwhile,
 * and drops intermediate states when input keeps arriving.
 */
export function useViewState() {
  const [live, setLive] = useState(() => readLocation())
  const [shown, setShown] = useState(live)
  const [pending, startTransition] = useTransition()
  const liveRef = useRef(live)

  const update = useCallback((patch: Partial<ViewState>, options?: { repeat?: boolean }) => {
    const next = { ...liveRef.current, ...patch }
    if ((Object.keys(next) as (keyof ViewState)[]).every((k) => next[k] === liveRef.current[k])) return
    noteSelectionChange(options?.repeat)
    liveRef.current = next
    setLive(next)
    startTransition(() => setShown(next))
  }, [])

  // The URL follows the controls immediately; replaceState, so stepping through days
  // doesn't flood the history. Page changes push (see navigate).
  useEffect(() => {
    const url = urlFor(live)
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url)
  }, [live])

  // Back/forward and in-app links: adopt whatever the address bar now says.
  useEffect(() => {
    const sync = () => update(readLocation(liveRef.current))
    window.addEventListener('popstate', sync)
    window.addEventListener('app:navigate', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('app:navigate', sync)
    }
  }, [update])

  return { live, shown, pending, update }
}
