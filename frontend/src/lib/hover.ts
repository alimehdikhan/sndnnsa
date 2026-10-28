import { useSyncExternalStore } from 'react'

/**
 * A shared crosshair position: charts that plot the same axis write to it on hover and
 * read it to draw their own marker, so hovering one highlights the same point in all.
 * Only the subscribed chart components re-render, never the page around them.
 */
export interface HoverStore {
  get: () => number | null
  set: (value: number | null) => void
  subscribe: (listener: () => void) => () => void
}

function createHoverStore(): HoverStore {
  let value: number | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (next === value) return
      value = next
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** UK hour of day (0-23): the error-by-hour chart and the three KPI sparklines. */
export const hourHover = createHoverStore()

export function useHover(store: HoverStore): number | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
