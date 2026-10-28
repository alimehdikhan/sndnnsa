import { useContext, useId, useState, type ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'
import { ArrowClockwiseIcon, ChartLineIcon, DatabaseIcon, TableIcon, WarningCircleIcon, type Icon } from '@phosphor-icons/react'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GlyphBadge, type Glyph } from '@/components/glyphs'
import { ChartSize } from '@/lib/chart-size'
import { useWidth } from '@/lib/use-width'
import { cn } from '@/lib/utils'

/* ---------- Card shell ---------- */

export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('themed min-w-0 rounded-[12px] border border-border bg-surface shadow-card', className)} {...rest}>
      {children}
    </section>
  )
}

/* ---------- Legend ---------- */

export interface LegendItem {
  label: string
  color: string
  kind: 'line' | 'dashed' | 'dot' | 'bar' | 'band' | 'hatch'
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-12 text-fg-2" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <LegendKey item={item} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function LegendKey({ item }: { item: LegendItem }) {
  if (item.kind === 'hatch') {
    return (
      <svg width="12" height="12" aria-hidden="true" className="shrink-0 rounded-[2px]">
        <rect width="12" height="12" fill={item.color} fillOpacity="0.14" />
        {[-6, 0, 6, 12].map((o) => (
          <line key={o} x1={o} y1="12" x2={o + 12} y2="0" stroke={item.color} strokeOpacity="0.7" strokeWidth="1" />
        ))}
      </svg>
    )
  }
  if (item.kind === 'dashed') {
    return (
      <svg width="16" height="2" aria-hidden="true" className="overflow-visible">
        <line x1="0" y1="1" x2="16" y2="1" stroke={item.color} strokeWidth="2" strokeDasharray="4 3" />
      </svg>
    )
  }
  const shape = {
    line: 'h-0.5 w-4 rounded-full',
    dot: 'size-2 rounded-full',
    bar: 'h-2.5 w-2 rounded-t-[2px]',
    band: 'size-2.5 rounded-[2px] ring-1 ring-inset ring-border-strong',
  }[item.kind]
  return <span aria-hidden="true" className={shape} style={{ background: item.color }} />
}

/* ---------- Chart card ---------- */

export type SkeletonKind = 'line' | 'bars' | 'scatter' | 'histogram'

interface ChartCardProps {
  id?: string
  /** Shown on a badge beside the title. */
  icon?: Glyph
  title: string
  subtitle?: ReactNode
  legend?: LegendItem[]
  loading: boolean
  error?: string
  onRetry?: () => void
  hasData: boolean
  empty?: { title: string; action?: { label: string; onClick: () => void } }
  height: number
  /** Size the chart from its width instead, e.g. to keep a scatter plot square. */
  heightFor?: (width: number) => number
  skeleton: SkeletonKind
  table?: TableSpec
  className?: string
  children: ReactNode
}

export function ChartCard(props: ChartCardProps) {
  const { title, subtitle, legend, loading, error, hasData, table } = props
  const [showTable, setShowTable] = useState(false)
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const width = useWidth(bodyEl)
  const height = props.heightFor && width ? props.heightFor(width) : props.height
  const titleId = useId()
  const ready = hasData && !error

  let body: ReactNode
  if (error && !loading) {
    body = <ErrorState height={height} message={error} onRetry={props.onRetry} />
  } else if (!hasData && loading) {
    body = <ChartSkeleton kind={props.skeleton} height={height} />
  } else if (!hasData) {
    body = <EmptyState height={height} title={props.empty?.title ?? 'No data for this selection'} action={props.empty?.action} />
  } else if (showTable && table) {
    body = <DataTable spec={table} maxHeight={height} />
  } else {
    body = (
      <div className={cn('chart relative transition-opacity duration-200', loading && 'opacity-60')} style={{ height }}>
        <ChartSize.Provider value={{ width, height }}>{props.children}</ChartSize.Provider>
      </div>
    )
  }

  return (
    <Panel aria-labelledby={titleId} aria-busy={loading} className={cn('flex flex-col', props.className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          {props.icon && <GlyphBadge glyph={props.icon} />}
          <div className="min-w-0">
            <h2 id={titleId} className="text-16 font-semibold text-fg">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-13 text-pretty text-fg-2">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {legend && !showTable && <Legend items={legend} />}
          {table && ready && (
            <button
              type="button"
              aria-pressed={showTable}
              aria-label={showTable ? 'Show chart' : 'Show table'}
              title={showTable ? 'Show chart' : 'Show table'}
              onClick={() => setShowTable((v) => !v)}
              className="press grid size-7 place-items-center rounded-[8px] text-fg-2 hover:bg-hover hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg"
            >
              {showTable ? <ChartLineIcon size={16} /> : <TableIcon size={16} />}
            </button>
          )}
        </div>
      </header>
      <div className="px-5 pt-4 pb-5">
        <div ref={setBodyEl}>{body}</div>
      </div>
    </Panel>
  )
}

/** Sizes a Recharts chart to its ChartCard body. */
export function ChartFrame({ children }: { children: React.ReactElement }) {
  const { width, height } = useContext(ChartSize)
  return (
    <ResponsiveContainer width={width || '100%'} height={height}>
      {children}
    </ResponsiveContainer>
  )
}

/* ---------- States ---------- */

function StateBox({ height, icon: IconCmp, tone, title, detail, action, role }: {
  height: number
  icon: Icon
  tone: 'muted' | 'error'
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
  role?: 'alert'
}) {
  return (
    <div style={{ height }} className="grid place-items-center rounded-[10px] border border-dashed border-border-strong" role={role}>
      <div className="flex max-w-[46ch] flex-col items-center px-6 text-center">
        <span
          className={cn(
            'grid size-10 place-items-center rounded-full',
            tone === 'error' ? 'bg-status-down-subtle text-status-down' : 'bg-hover text-fg-3',
          )}
        >
          <IconCmp size={20} weight="bold" />
        </span>
        <p className="mt-3 text-14 font-semibold text-fg">{title}</p>
        {detail && <p className="mt-1 text-13 text-fg-2">{detail}</p>}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="press mt-4 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border-strong bg-control px-3.5 text-13 font-medium text-fg shadow-card hover:bg-hover"
          >
            {action.label === 'Try again' && <ArrowClockwiseIcon size={14} weight="bold" />}
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

export function ErrorState({ height, message, onRetry }: { height: number; message: string; onRetry?: () => void }) {
  return (
    <StateBox
      height={height}
      icon={WarningCircleIcon}
      tone="error"
      role="alert"
      title="Couldn't load this data"
      detail={message}
      action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
    />
  )
}

export function EmptyState({ height, title, action }: { height: number; title: string; action?: { label: string; onClick: () => void } }) {
  return <StateBox height={height} icon={DatabaseIcon} tone="muted" title={title} action={action} />
}

/* ---------- Skeletons shaped like the chart they stand in for ---------- */

const BAR_HEIGHTS = [62, 70, 76, 84, 82, 86, 80, 71, 64, 60, 58, 57, 55, 54, 52, 50, 49, 55, 57, 58, 54, 50, 52, 56]
const HIST_HEIGHTS = [3, 4, 4, 6, 12, 24, 22, 30, 52, 78, 96, 74, 62, 46, 34, 22, 12, 14, 16, 10, 6, 4]
const SCATTER = Array.from({ length: 70 }, (_, i) => {
  const t = (i * 37) % 100
  const jitter = ((i * 53) % 21) - 10
  return { x: 6 + t * 0.88, y: 94 - t * 0.82 - Math.abs(jitter) * 0.9 }
})

export function ChartSkeleton({ kind, height }: { kind: SkeletonKind; height: number }) {
  return (
    <div className="skeleton bg-transparent!" style={{ height }} aria-label="Loading chart" role="status">
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
        {[8, 30, 52, 74, 96].map((y) => (
          <line key={y} x1="7" x2="100" y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {[8, 30, 52, 74, 96].map((y) => (
          <rect key={`t${y}`} x="0" y={y - 1.5} width="4.5" height="3" rx="0.6" fill="var(--skeleton)" />
        ))}
        {kind === 'line' && (
          <path
            d="M7,62 C14,58 18,55 24,57 S34,63 40,59 S52,48 58,50 S70,58 76,54 S88,45 100,47"
            fill="none"
            stroke="var(--skeleton)"
            strokeWidth="6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {kind === 'bars' &&
          BAR_HEIGHTS.map((h, i) => (
            <rect key={i} x={8.5 + i * 3.8} y={96 - h} width="2.2" height={h} rx="0.5" fill="var(--skeleton)" />
          ))}
        {kind === 'histogram' &&
          HIST_HEIGHTS.map((h, i) => (
            <rect key={i} x={8 + i * 4.18} y={96 - h * 0.86} width="3.7" height={h * 0.86} rx="0.4" fill="var(--skeleton)" />
          ))}
        {kind === 'scatter' &&
          SCATTER.map((p, i) => <ellipse key={i} cx={p.x} cy={p.y} rx="0.9" ry="1.3" fill="var(--skeleton)" />)}
      </svg>
    </div>
  )
}

/* ---------- Tooltip ---------- */

export interface TooltipRow {
  color: string
  label: string
  value: string
}

/** Custom Recharts tooltip body: UK time on top, values in mono with series dots. */
export function TooltipCard({ head, rows, note }: { head: string; rows: TooltipRow[]; note?: TooltipRow }) {
  return (
    <div className="min-w-[196px] rounded-[10px] bg-raised px-3 py-2.5 text-12 shadow-popover">
      <p className="num mb-2 text-12 font-medium text-fg-2">{head}</p>
      <div className="grid gap-1">
        {rows.map((row) => (
          <TooltipLine key={row.label} row={row} />
        ))}
      </div>
      {note && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <TooltipLine row={note} />
        </div>
      )}
    </div>
  )
}

function TooltipLine({ row }: { row: TooltipRow }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />
      <span className="text-fg-2">{row.label}</span>
      <span className="num ml-auto pl-4 text-13 font-semibold text-fg">{row.value}</span>
    </div>
  )
}

/* ---------- Table ---------- */

export type Tint = 'over' | 'under'
export type Cell = ReactNode | { value: ReactNode; tint?: Tint }

export interface TableSpec {
  caption: string
  columns: { key: string; label: string; numeric?: boolean }[]
  rows: Record<string, Cell>[]
}

function isTinted(cell: Cell): cell is { value: ReactNode; tint?: Tint } {
  return typeof cell === 'object' && cell !== null && 'value' in (cell as object)
}

export function DataTable({ spec, maxHeight }: { spec: TableSpec; maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <Table className="text-13">
        <TableCaption className="sr-only">{spec.caption}</TableCaption>
        <TableHeader className="sticky top-0 z-[1] bg-surface">
          <TableRow className="border-border hover:bg-transparent">
            {spec.columns.map((c) => (
              <TableHead key={c.key} className={cn('label h-9 px-3', c.numeric && 'text-right')}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {spec.rows.map((row, i) => (
            <TableRow key={i} className="border-border transition-colors duration-150 hover:bg-hover">
              {spec.columns.map((c) => {
                const cell = row[c.key]
                const tinted = isTinted(cell) ? cell : null
                return (
                  <TableCell
                    key={c.key}
                    className={cn('h-11 px-3 text-fg', c.numeric && 'num text-right')}
                  >
                    {tinted ? (
                      <span
                        className={cn(
                          'inline-flex h-6 items-center rounded-full px-2.5 font-semibold',
                          tinted.tint === 'over' ? 'bg-over-subtle text-over-text' : 'bg-under-subtle text-under-text',
                        )}
                      >
                        {tinted.value}
                      </span>
                    ) : (
                      (cell as ReactNode)
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
