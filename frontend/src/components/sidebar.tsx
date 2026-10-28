import type { MouseEvent, ReactNode } from 'react'
import {
  AccuracyGlyph,
  CoverageGlyph,
  DataGlyph,
  DecisionGlyph,
  KeysGlyph,
  MoonGlyph,
  SidebarGlyph,
  SourceGlyph,
  SunGlyph,
  type Glyph,
} from '@/components/glyphs'
import { monthYear, shiftDay } from '@/lib/format'
import { useDayRange, useEngine } from '@/lib/queries'
import type { Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { navigate, type Route } from '@/lib/view-state'

const NAV: { to: Route; label: string; detail: string; icon: Glyph; shortcut: string }[] = [
  { to: '/decision', label: 'Decision view', detail: 'Replay one gate closure', icon: DecisionGlyph, shortcut: 'D' },
  { to: '/accuracy', label: 'Accuracy view', detail: 'Score the whole month', icon: AccuracyGlyph, shortcut: 'A' },
]

interface SidebarProps {
  route: Route
  collapsed: boolean
  onCollapsed: (collapsed: boolean) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  onShortcuts: () => void
}

export function Sidebar({ route, collapsed, onCollapsed, theme, onTheme, onShortcuts }: SidebarProps) {
  return (
    <aside
      className="themed sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-chrome transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-expanded)' }}
    >
      <Brand collapsed={collapsed} />

      <nav aria-label="Pages" className="px-3 pt-6">
        {!collapsed && <p className="mb-2 px-2 text-11 font-semibold text-fg-3">Views</p>}
        <ul className="grid gap-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavItem {...item} active={route === item.to} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>

      {!collapsed && <SnapshotCard />}

      <div className={cn('grid gap-2 border-t border-border p-3', collapsed && 'mt-auto justify-items-center gap-1')}>
        {collapsed ? (
          <>
            <IconButton icon={KeysGlyph} label="Keyboard shortcuts (?)" onClick={onShortcuts} />
            <IconButton
              icon={theme === 'dark' ? SunGlyph : MoonGlyph}
              label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <IconButton icon={SidebarGlyph} label="Expand sidebar" onClick={() => onCollapsed(false)} expanded={false} />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onShortcuts}
              className="press flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-13 font-medium text-fg-2 hover:bg-hover hover:text-fg"
            >
              <KeysGlyph size={18} />
              Keyboard shortcuts
              <Kbd className="ml-auto">?</Kbd>
            </button>
            <div className="flex items-center gap-2">
              <ThemeSwitch theme={theme} onTheme={onTheme} />
              <IconButton icon={SidebarGlyph} label="Collapse sidebar" onClick={() => onCollapsed(true)} expanded />
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

/* ---------- Pieces ---------- */

/** The app mark: three wind lines of different lengths, the top one curling back. */
function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5h10.25a2.75 2.75 0 1 0-2.75-2.75" />
      <path d="M3.5 12.5h15.25a2.75 2.75 0 1 1-2.75 2.75" />
      <path d="M3.5 16.5h7" opacity={0.75} />
    </svg>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  const range = useDayRange()
  return (
    <a
      href="/decision"
      onClick={(e) => go(e, '/decision')}
      title="Home"
      className={cn('mx-3 mt-4 flex items-center gap-3 rounded-[10px] px-2', collapsed && 'justify-center px-0')}
    >
      <span className="app-icon grid size-9 shrink-0 place-items-center rounded-[10px]">
        <BrandMark />
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-14 font-semibold text-fg">GB Wind Forecast</span>
          <span className="mt-0.5 block truncate text-12 text-fg-3">Monitor{range ? ` · ${monthYear(range.first)}` : ''}</span>
        </span>
      )}
    </a>
  )
}

function NavItem({ to, label, detail, icon: NavIcon, shortcut, active, collapsed }: (typeof NAV)[number] & { active: boolean; collapsed: boolean }) {
  return (
    <a
      href={to}
      onClick={(e) => go(e, to)}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? `${label} (${shortcut})` : undefined}
      className={cn(
        'press group flex items-center gap-3 rounded-[10px] p-2',
        active ? 'bg-surface shadow-card ring-1 ring-border' : 'hover:bg-hover',
        collapsed && 'justify-center p-1.5',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors duration-150',
          active ? 'bg-teal-subtle text-teal-text' : 'bg-hover text-fg-3 group-hover:text-fg-2',
        )}
      >
        <NavIcon size={18} />
      </span>
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate text-13 font-semibold', active ? 'text-fg' : 'text-fg-2 group-hover:text-fg')}>{label}</span>
            <span className="block truncate text-11 text-fg-3">{detail}</span>
          </span>
          <Kbd>{shortcut}</Kbd>
        </>
      )}
    </a>
  )
}

const dayMonthFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "2–31 Jan" for the snapshot's delivery days (the end is exclusive). */
function compactRange(start: string, end: string): string {
  const a = new Date(`${start.slice(0, 10)}T12:00:00Z`)
  const b = new Date(`${shiftDay(end.slice(0, 10), -1)}T12:00:00Z`)
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${dayMonthFmt.format(b)}` : `${dayMonthFmt.format(a)} – ${dayMonthFmt.format(b)}`
}

/** What the app has loaded and computes every view from, in the sidebar's spare height. */
function SnapshotCard() {
  const engine = useEngine().data
  const m = engine?.meta
  // The date range gets the full width: across a month boundary it's too long for half a tile.
  const stats: { value: string; label: string; wide?: boolean }[] = [
    { value: m ? compactRange(m.start, m.end) : '—', label: engine ? `${engine.days().length} delivery days` : 'Delivery days', wide: true },
    { value: m ? m.actualRows.toLocaleString('en-GB') : '—', label: 'Half-hours' },
    { value: m ? m.forecastRuns.toLocaleString('en-GB') : '—', label: 'Forecast runs' },
  ]
  return (
    <section aria-label="Data snapshot" className="mx-3 mt-auto mb-3 rounded-[12px] border border-border bg-surface p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-12 font-semibold text-fg">
          <DataGlyph size={16} className="text-teal-text" />
          Data snapshot
        </p>
        {engine && (
          <span className="inline-flex items-center gap-1 text-11 font-medium text-status-ok" title="Every view is computed in the browser from this snapshot">
            <CoverageGlyph size={14} />
            Loaded
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-1.5">
        {stats.map((s) => (
          <div key={s.label} className={cn('flex min-w-0 flex-col-reverse rounded-[8px] bg-hover px-2.5 py-2', s.wide && 'col-span-2')}>
            <dt className="truncate text-11 text-fg-3">{s.label}</dt>
            <dd className="num truncate text-14 font-semibold text-fg">{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 flex items-center gap-1.5 truncate text-11 text-fg-3">
        <SourceGlyph size={14} />
        Source · Elexon BMRS
      </p>
    </section>
  )
}

/** Light / Dark as an Apple-style segmented switch. */
function ThemeSwitch({ theme, onTheme }: { theme: Theme; onTheme: (theme: Theme) => void }) {
  const options: { value: Theme; label: string; icon: Glyph }[] = [
    { value: 'light', label: 'Light', icon: SunGlyph },
    { value: 'dark', label: 'Dark', icon: MoonGlyph },
  ]
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid h-8 flex-1 grid-cols-2 rounded-[8px] bg-control-track p-[2px]">
      {options.map(({ value, label, icon: OptionIcon }) => {
        const on = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onPointerDown={(e) => e.pointerType === 'mouse' && e.button === 0 && onTheme(value)}
            onClick={() => onTheme(value)}
            className={cn(
              'press inline-flex items-center justify-center gap-1.5 rounded-[6px] text-12 font-medium',
              on ? 'bg-control-thumb text-fg shadow-thumb' : 'text-fg-3 hover:text-fg',
            )}
          >
            <OptionIcon size={15} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

function IconButton({ icon: ButtonIcon, label, onClick, expanded }: { icon: Glyph; label: string; onClick: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className="press grid size-8 shrink-0 place-items-center rounded-[8px] text-fg-2 hover:bg-hover hover:text-fg"
    >
      <ButtonIcon size={18} />
    </button>
  )
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'num grid h-5 min-w-5 shrink-0 place-items-center rounded-[5px] border border-border bg-surface px-1 text-11 font-semibold text-fg-3 shadow-card',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

function go(e: MouseEvent<HTMLAnchorElement>, to: Route) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
  e.preventDefault()
  navigate(to)
}
