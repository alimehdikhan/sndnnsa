import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import { getJson, paths, GATES } from '@/lib/api'
import { Engine, type DatasetSnapshot } from '@/lib/engine'

/** The API serves a fixed snapshot, so nothing fetched ever goes stale in a session. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      // Ride out a short API restart: retry after 1 s, then 2 s, before showing an error.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
})

/**
 * The whole snapshot, fetched once (about 50 KB gzipped). Every view after that is
 * computed in the browser by the Engine, so no interaction waits on the network.
 */
export const datasetQuery = queryOptions({
  queryKey: ['dataset'],
  queryFn: async ({ signal }) => new Engine(await getJson<DatasetSnapshot>(paths.dataset, signal)),
})

export function useEngine() {
  return useQuery(datasetQuery)
}

/** First and last UK delivery day in the snapshot, once it has loaded. */
export function useDayRange(): { first: string; last: string } | null {
  const engine = useEngine().data
  const days = engine?.days()
  return days?.length ? { first: days[0], last: days[days.length - 1] } : null
}

/** Run `task` when the browser is idle, so background work never competes with the current view. */
export function whenIdle(task: (deadline?: IdleDeadline) => void): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 2000 })
  else setTimeout(task, 200)
}

/**
 * Compute, in idle time, every view a click could ask for next: each gate's accuracy,
 * error by horizon, all 49 horizons, and every day at every gate. Each is cached in the
 * engine, so the first visit to any selection is as fast as a repeat visit.
 */
export function warmUp(engine: Engine): void {
  const tasks: (() => unknown)[] = [
    () => engine.byHorizon(),
    ...GATES.map((gate) => () => engine.accuracy({ mode: 'gate', gate })),
    ...Array.from({ length: 49 }, (_, h) => () => engine.accuracy({ mode: 'horizon', h })),
    ...engine.days().flatMap((day) => GATES.map((gate) => () => engine.decision(day, gate))),
  ]
  const run = (deadline?: IdleDeadline) => {
    // A few ms at a time, never past the browser's idle budget.
    while (tasks.length && (deadline ? deadline.timeRemaining() > 2 : true)) {
      tasks.shift()!()
      if (!deadline) break
    }
    if (tasks.length) whenIdle(run)
  }
  whenIdle(run)
}
