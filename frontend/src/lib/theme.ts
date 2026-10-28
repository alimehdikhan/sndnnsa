import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'theme'
const SIDEBAR_KEY = 'sidebar-collapsed'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // storage blocked (private mode, sandboxed preview)
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // not persisted; the choice still applies for this visit
  }
}

/** Dark by default; index.html applies the stored theme before first paint. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next
    write(THEME_KEY, next)
    setThemeState(next)
  }, [])
  return [theme, setTheme]
}

/** Sidebar starts collapsed on narrow screens unless the viewer chose otherwise. */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setState] = useState(() => {
    const stored = read(SIDEBAR_KEY)
    return stored === null ? window.innerWidth < 1024 : stored === 'true'
  })
  const setCollapsed = useCallback((next: boolean) => {
    write(SIDEBAR_KEY, String(next))
    setState(next)
  }, [])
  return [collapsed, setCollapsed]
}
