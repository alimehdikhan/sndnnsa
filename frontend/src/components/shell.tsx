import type { ReactNode } from 'react'
import { ArrowClockwiseIcon, WifiSlashIcon } from '@phosphor-icons/react'
import { DataGlyph, GlyphBadge, HourGlyph, type Glyph } from '@/components/glyphs'
import { shortDay, shiftDay, ukDay, ukTime, ukZone } from '@/lib/format'
import type { Health } from '@/lib/health'
import { useEngine } from '@/lib/queries'
import { cn } from '@/lib/utils'

/* ---------- Page header ---------- */

interface PageHeaderProps {
  icon: Glyph
  title: string
  description: string
  controls: ReactNode
}

export function PageHeader({ icon, title, description, controls }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="flex min-w-0 max-w-[66ch] items-start gap-4">
        <GlyphBadge glyph={icon} tone="accent" size="lg" />
        <div className="min-w-0">
          <h1 className="text-28 font-bold text-fg">{title}</h1>
          <p className="mt-1 text-14 text-pretty text-fg-2">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">{controls}</div>
    </header>
  )
}

/* ---------- Status strip ---------- */

const HEALTH_LABEL: Record<Health, string> = { checking: 'Checking API', ok: 'API online', down: 'API offline', static: 'Static snapshot' }
const HEALTH_DOT: Record<Health, string> = { checking: 'bg-status-warn', ok: 'bg-status-ok', down: 'bg-status-down', static: 'bg-teal' }

export function StatusStrip({ health }: { health: Health }) {
  const m = useEngine().data?.meta
  return (
    <footer
      className="themed sticky bottom-0 z-10 flex shrink-0 items-center gap-x-6 overflow-hidden border-t border-border bg-chrome px-8 text-12 whitespace-nowrap text-fg-2"
      style={{ height: 'var(--status-strip)' }}
    >
      <span className="inline-flex min-w-[200px] items-center gap-1.5 truncate xl:min-w-[450px]">
        <DataGlyph size={14} className="text-fg-3" />
        Snapshot{' '}
        {m ? (
          <>
            <span className="num text-fg">
              {shortDay(m.start.slice(0, 10))} – {shortDay(shiftDay(m.end.slice(0, 10), -1))} {shiftDay(m.end.slice(0, 10), -1).slice(0, 4)}
            </span>
            <span className="hidden xl:inline">
              {' '}· <span className="num">{m.actualRows.toLocaleString('en-GB')}</span> half-hours ·{' '}
              <span className="num">{m.forecastRuns}</span> forecast runs
            </span>
          </>
        ) : (
          <span className="text-fg-3">—</span>
        )}
      </span>
      <span className="hidden min-w-[170px] items-center gap-1.5 truncate sm:inline-flex">
        <HourGlyph size={14} className="text-fg-3" />
        Refreshed{' '}
        {m?.refreshedAt ? (
          <span className="num text-fg">
            {ukTime(m.refreshedAt)} {ukDay(m.refreshedAt)} <span className="text-fg-2">{ukZone(m.refreshedAt)}</span>
          </span>
        ) : (
          <span className="text-fg-3">{m ? 'unknown' : '—'}</span>
        )}
      </span>
      <span className="ml-auto inline-flex items-center gap-2" role="status" aria-live="polite">
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', HEALTH_DOT[health])} />
        {HEALTH_LABEL[health]}
      </span>
    </footer>
  )
}

/* ---------- Offline banner ---------- */

/** Shown while the API is unreachable; the page recovers by itself when it's back. */
export function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="themed mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-status-down/30 bg-status-down-subtle px-4 py-3"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-status-down/15 text-status-down">
        <WifiSlashIcon size={16} weight="bold" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-14 font-semibold text-fg">Can't reach the API</p>
        <p className="text-13 text-fg-2">
          Start the backend with <code className="num rounded-[4px] bg-hover px-1 py-px text-fg">make dev</code>. This page
          reconnects and reloads its data automatically.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border-strong bg-control px-3 text-13 font-medium text-fg shadow-card hover:bg-hover"
      >
        <ArrowClockwiseIcon size={14} weight="bold" />
        Try now
      </button>
    </div>
  )
}
