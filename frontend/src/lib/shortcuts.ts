import { useEffect, useRef } from 'react'

export interface ShortcutGroup {
  title: string
  items: { keys: string[]; label: string }[]
}

/** What the keyboard does, for the shortcuts sheet (handled in App). */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Decision view',
    items: [
      { keys: ['←', '→'], label: 'Previous / next day' },
      { keys: ['Shift', '←', '→'], label: 'Week back / forward' },
      { keys: ['Home', 'End'], label: 'First / last day' },
      { keys: ['1', '2', '3'], label: 'Gates 09:20 · 09:50 · 15:30' },
    ],
  },
  {
    title: 'Accuracy view',
    items: [
      { keys: ['G'], label: 'Score by gate' },
      { keys: ['H'], label: 'Score by horizon' },
      { keys: ['1', '2', '3'], label: 'Gates 09:20 · 09:50 · 15:30' },
      { keys: ['←', '→'], label: 'Horizon −1 / +1 h' },
      { keys: ['Shift', '←', '→'], label: 'Horizon −6 / +6 h' },
      { keys: ['Home', 'End'], label: 'Horizon 0 h / 48 h' },
    ],
  },
  {
    title: 'Anywhere',
    items: [
      { keys: ['D'], label: 'Decision view' },
      { keys: ['A'], label: 'Accuracy view' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
]

/**
 * Keys typed into a field, or already handled by a focused control (a slider, the
 * segmented controls' arrow-key focus, the calendar grid), are left alone.
 */
function ignored(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return true
  const target = e.target as HTMLElement | null
  if (!target) return false
  if (target.isContentEditable || target.closest('input, textarea, select, [role="slider"], [role="grid"]')) return true
  return false
}

/** One window keydown listener that always calls the latest handler. */
export function useShortcuts(handler: (e: KeyboardEvent) => boolean | void): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignored(e)) return
      if (latest.current(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
