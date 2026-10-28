import { lazy, Suspense, useEffect, useState } from 'react'
import { OfflineBanner, StatusStrip } from '@/components/shell'
import { Sidebar } from '@/components/sidebar'
import { GATES } from '@/lib/api'
import { shiftDay } from '@/lib/format'
import { useApiHealth } from '@/lib/health'
import { datasetQuery, queryClient, useDayRange, useEngine, warmUp, whenIdle } from '@/lib/queries'
import { useShortcuts } from '@/lib/shortcuts'
import { useSidebarCollapsed, useTheme } from '@/lib/theme'
import { navigate, readLocation, useViewState, type Route } from '@/lib/view-state'
import { loadAccuracyPage, loadDecisionPage } from '@/pages/loaders'

// Each page is its own chunk: the Decision view never downloads the Accuracy view's code.
const DecisionView = lazy(loadDecisionPage)
const AccuracyView = lazy(loadAccuracyPage)
const ShortcutsDialog = lazy(() => import('@/components/shortcuts-dialog'))

const TITLES: Record<Route, string> = {
  '/decision': 'Decision view',
  '/accuracy': 'Accuracy view',
}

// Start the dataset and the first page's code together, before React renders, so
// neither waits on the other. After this one request, nothing touches the network.
void queryClient.prefetchQuery(datasetQuery)
void (readLocation().route === '/accuracy' ? loadAccuracyPage() : loadDecisionPage())

const clampH = (h: number) => Math.min(48, Math.max(0, h))

export default function App() {
  const [theme, setTheme] = useTheme()
  const [collapsed, setCollapsed] = useSidebarCollapsed()
  const { health, checkNow } = useApiHealth()
  const { live, shown, pending, update } = useViewState()
  const engine = useEngine().data
  // The day range comes from the snapshot, so a refreshed snapshot for another month just works.
  const range = useDayRange()
  const clampDay = (day: string) => (!range ? day : !day || day < range.first ? range.first : day > range.last ? range.last : day)

  // Once the range is known, put a missing or out-of-range day from the URL in range.
  useEffect(() => {
    if (range && clampDay(live.day) !== live.day) update({ day: clampDay(live.day) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the range arrives
  }, [range?.first, range?.last])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // The sheet's code loads on first open, then stays mounted so it can animate closed.
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false)
  const openShortcuts = (open: boolean) => {
    if (open) setShortcutsLoaded(true)
    setShortcutsOpen(open)
  }

  useEffect(() => {
    document.title = `${TITLES[live.route]} · GB Wind Forecast Monitor`
  }, [live.route])

  // Once the data is here, compute every other view in idle time and fetch the other page's code.
  useEffect(() => {
    if (!engine) return
    warmUp(engine)
    whenIdle(() => void (readLocation().route === '/decision' ? loadAccuracyPage() : loadDecisionPage()))
  }, [engine])

  useShortcuts((e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const act = (change: () => void) => {
      change()
      return true
    }
    if (key === '?') return act(() => openShortcuts(!shortcutsOpen))
    if (shortcutsOpen) return false
    if (key === 'd') return act(() => navigate('/decision'))
    if (key === 'a') return act(() => navigate('/accuracy'))
    const gate = GATES[['1', '2', '3'].indexOf(key)]
    const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    const repeat = e.repeat

    if (live.route === '/decision') {
      if (gate) return act(() => update({ decisionGate: gate }))
      if (step) return act(() => update({ day: clampDay(shiftDay(live.day, step * (e.shiftKey ? 7 : 1))) }, { repeat }))
      if (key === 'Home') return act(() => range && update({ day: range.first }))
      if (key === 'End') return act(() => range && update({ day: range.last }))
      return false
    }
    if (gate) return act(() => update({ mode: 'gate', accuracyGate: gate }))
    if (key === 'g') return act(() => update({ mode: 'gate' }))
    if (key === 'h') return act(() => update({ mode: 'horizon' }))
    if (live.mode === 'horizon') {
      if (step) return act(() => update({ h: clampH(live.h + step * (e.shiftKey ? 6 : 1)) }, { repeat }))
      if (key === 'Home') return act(() => update({ h: 0 }))
      if (key === 'End') return act(() => update({ h: 48 }))
      return false
    }
    const nextGate = GATES[GATES.indexOf(live.accuracyGate) + step]
    if (step) return act(() => nextGate && update({ accuracyGate: nextGate }, { repeat }))
    return false
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar
        route={live.route}
        collapsed={collapsed}
        onCollapsed={setCollapsed}
        theme={theme}
        onTheme={setTheme}
        onShortcuts={() => openShortcuts(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-6 pt-6 pb-10">
          <div className="mx-auto max-w-[var(--content-max)]">
            {health === 'down' && <OfflineBanner onRetry={checkNow} />}
            {/* Page changes render in a transition too, so the old page stays up until the new one is ready. */}
            <Suspense fallback={<div aria-busy="true" className="h-[96px]" />}>
              {shown.route === '/decision' ? (
                <DecisionView
                  live={{ day: clampDay(live.day), gate: live.decisionGate }}
                  shown={{ day: clampDay(shown.day), gate: shown.decisionGate }}
                  range={range}
                  pending={pending}
                  onDay={(day, repeat) => update({ day }, { repeat })}
                  onGate={(decisionGate) => update({ decisionGate })}
                />
              ) : (
                <AccuracyView
                  live={{ mode: live.mode, gate: live.accuracyGate, h: live.h }}
                  shown={{ mode: shown.mode, gate: shown.accuracyGate, h: shown.h }}
                  pending={pending}
                  onMode={(mode) => update({ mode })}
                  onGate={(accuracyGate) => update({ accuracyGate })}
                  onH={(h) => update({ h })}
                />
              )}
            </Suspense>
          </div>
        </main>
        <StatusStrip health={health} />
      </div>
      {shortcutsLoaded && (
        <Suspense fallback={null}>
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={openShortcuts} />
        </Suspense>
      )}
    </div>
  )
}
