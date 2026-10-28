import { memo, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnimatedNumber } from '@/components/animated-number'
import { ChartCard, Legend, Panel, TooltipCard, type TableSpec, type TooltipRow } from '@/components/chart-card'
import { DatePicker, Segmented } from '@/components/controls'
import {
  BiasGlyph,
  BufferGlyph,
  CoverageGlyph,
  DecisionGlyph,
  GateGlyph,
  GlyphBadge,
  HorizonGlyph,
  HourGlyph,
  MaeGlyph,
  PeakGlyph,
  RunGlyph,
  SeriesGlyph,
  SummaryGlyph,
  type Glyph,
} from '@/components/glyphs'
import { PageHeader } from '@/components/shell'
import { GATES, type DecisionView as DecisionBundle, type Gate } from '@/lib/api'
import { AREA_OPACITY, AXIS, C, CHART_MARGIN, GRID, niceTicks } from '@/lib/chart'
import { useChartSize } from '@/lib/chart-size'
import { leadRange, londonDayWindow, longDay, mw, mwNumber, shiftDay, shortDay, signedMw, ukDay, ukTime, ukZone } from '@/lib/format'
import { useChartAnimation } from '@/lib/motion'
import { useEngine } from '@/lib/queries'

interface Selection {
  day: string
  gate: Gate
}

interface DecisionViewProps {
  /** What the controls show: updates on the same frame as the input. */
  live: Selection
  /** What the charts show: follows `live` in a transition. */
  shown: Selection
  /** Delivery days in the snapshot; null until it loads. */
  range: { first: string; last: string } | null
  pending: boolean
  onDay: (day: string, repeat?: boolean) => void
  onGate: (gate: Gate) => void
}

export function DecisionView({ live, shown, range, pending, onDay, onGate }: DecisionViewProps) {
  const { day, gate } = shown
  // Empty until the snapshot (and so the first day) has loaded.
  const dayWindow = useMemo(() => (day ? londonDayWindow(day) : null), [day])
  const viewportHeight = useViewportHeight()
  // Computed in the browser from the one snapshot: no request per day or gate.
  const dataset = useEngine()
  const engine = dataset.data
  const model = useMemo(() => (engine && day ? buildDay(engine.decision(day, gate)) : null), [engine, day, gate])
  // Only the very first load waits; after that the previous view stays up while the next renders.
  const loading = !engine && dataset.isFetching
  const error = engine ? undefined : dataset.error?.message
  const failed = !!error && !loading

  return (
    <>
      <PageHeader
        icon={DecisionGlyph}
        title="Decision view"
        description="The forecast available at gate closure on the day before delivery, against what the wind actually did."
        controls={
          <>
            <DatePicker label="Delivery day" day={live.day} min={range?.first ?? ''} max={range?.last ?? ''} onDay={onDay} />
            <Segmented
              label="Gate · day before, UK"
              options={GATES.map((g) => ({ value: g, label: g }))}
              value={live.gate}
              onChange={onGate}
            />
          </>
        }
      />

      <div className="view grid grid-cols-12 gap-6" data-pending={pending}>
        <ChartCard
          className="col-span-12 xl:col-span-9"
          icon={SeriesGlyph}
          title="Actual vs forecast generation"
          subtitle={dayWindow ? `${longDay(day)} · MW · UK time (${ukZone(dayWindow.start)})` : 'MW · UK time'}
          legend={[
            { label: 'Actual', color: C.actual, kind: 'line' },
            { label: 'Forecast', color: C.forecast, kind: 'dashed' },
            { label: 'P90 buffer', color: C.forecast, kind: 'hatch' },
          ]}
          loading={loading}
          error={error}
          onRetry={() => void dataset.refetch()}
          hasData={!!model}
          height={460 + STRIP_BLOCK}
          heightFor={(width) => dayChartHeight(width, viewportHeight - STRIP_BLOCK) + STRIP_BLOCK}
          skeleton="line"
          table={model ? dayTable(model) : undefined}
        >
          {model && <DayChart model={model} />}
        </ChartCard>

        <div className="col-span-12 grid content-start gap-6 md:grid-cols-2 xl:col-span-3 xl:grid-cols-1">
          {model ? (
            <ForecastUsed model={model} gate={gate} day={day} />
          ) : failed ? (
            <SidePanel icon={RunGlyph} title="Forecast used">
              <Unavailable />
            </SidePanel>
          ) : (
            <ForecastUsedSkeleton />
          )}
          {model ? (
            <DaySummary model={model} />
          ) : failed ? (
            <SidePanel icon={SummaryGlyph} title="Day summary">
              <Unavailable />
            </SidePanel>
          ) : (
            <DaySummarySkeleton />
          )}
        </div>
      </div>
    </>
  )
}

/**
 * The day chart is the page's subject, so on a desktop it fills the screen down to
 * the status strip; on narrow screens it keeps a readable aspect instead.
 */
function dayChartHeight(width: number, viewportHeight: number): number {
  return Math.round(Math.min(640, Math.max(280, Math.min(width * 0.66, viewportHeight - 310))))
}

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

/* ---------- Model ---------- */

interface Row {
  t: number
  iso: string
  actual: number | null
  forecast: number | null // only on the hour, where a forecast exists
  forecastLine: number | null // the hourly points joined, for drawing only
  band: [number, number] | null // forecast - P90 buffer .. forecast
  error: number | null // forecast - actual, on the hour
}

interface DayModel {
  rows: Row[]
  start: number
  end: number
  ticks: number[]
  runs: string[]
  leadMin: number | null
  leadMax: number | null
  hoursForecast: number
  hoursTotal: number
  mae: number | null
  bias: number | null
  maxOver: { value: number; iso: string } | null
  p90: number | null
}

const HALF_HOUR = 30 * 60 * 1000

/** Chart rows (every half-hour) plus the server's day KPIs. */
function buildDay(view: DecisionBundle): DayModel {
  const start = new Date(view.start).getTime()
  const end = new Date(view.end).getTime()
  const p90 = view.kpis.p90Over
  const actualAt = new Map(view.actuals.map((p) => [new Date(p.startTime).getTime(), p.generation]))
  const forecastAt = new Map(view.forecast.map((p) => [new Date(p.startTime).getTime(), p.generation]))

  const rows: Row[] = []
  for (let t = start; t < end; t += HALF_HOUR) {
    const forecast = forecastAt.get(t) ?? null
    const actual = actualAt.get(t) ?? null
    let forecastLine = forecast
    if (forecastLine === null && !forecastAt.has(t)) {
      const before = forecastAt.get(t - HALF_HOUR)
      const after = forecastAt.get(t + HALF_HOUR)
      if (before != null && after != null) forecastLine = (before + after) / 2
    }
    rows.push({
      t,
      iso: new Date(t).toISOString(),
      actual,
      forecast,
      forecastLine,
      band: forecastLine !== null && p90 !== null ? [Math.max(0, forecastLine - p90), forecastLine] : null,
      error: forecast !== null && actual !== null ? forecast - actual : null,
    })
  }

  const ticks: number[] = []
  for (let t = start; t <= end; t += 3 * 60 * 60 * 1000) ticks.push(t)

  return {
    rows,
    start,
    end,
    ticks,
    runs: view.runs,
    leadMin: view.leadMin,
    leadMax: view.leadMax,
    hoursForecast: view.hoursForecast,
    hoursTotal: view.hoursTotal,
    mae: view.kpis.mae,
    bias: view.kpis.bias,
    maxOver: view.kpis.maxOver ? { value: view.kpis.maxOver.value, iso: view.kpis.maxOver.startTime } : null,
    p90,
  }
}

/* ---------- Chart ---------- */

// The error strip under the main chart: a label row, then the bars.
const STRIP_H = 70
const STRIP_BLOCK = STRIP_H + 48

const signedNumber = (n: number) => signedMw(n).replace(' MW', '')
const signedTick = (v: number) => (v === 0 ? '0' : signedNumber(v))

const DayChart = memo(function DayChart({ model }: { model: DayModel }) {
  const animation = useChartAnimation('decision-day', true)
  const { width, height } = useChartSize()
  const gradientId = useId().replace(/:/g, '')
  const yTicks = niceTicks(Math.max(0, ...model.rows.flatMap((r) => [r.actual ?? 0, r.forecastLine ?? 0])))
  const latestRun = model.runs.at(-1)
  const runTime = latestRun ? new Date(latestRun).getTime() : null
  const runInView = runTime !== null && runTime >= model.start && runTime <= model.end
  // The strip's scale fits its own data: all over-forecast days get the full height.
  const errors = model.rows.map((r) => r.error ?? 0)
  const errorHi = Math.max(0, ...errors) > 0 ? niceTicks(Math.max(...errors)).at(-1)! : 0
  const errorLo = Math.min(0, ...errors) < 0 ? -niceTicks(-Math.min(...errors)).at(-1)! : 0
  const errorTicks = [errorLo, 0, errorHi].filter((v, i, all) => all.indexOf(v) === i)
  // One slim bar per hour.
  const barSize = Math.min(10, Math.max(2, Math.floor(((width - 60) / (model.rows.length / 2)) * 0.36)))

  return (
    <div style={{ width: width || '100%' }}>
      {/* Both plots share syncId and rows, so one crosshair and tooltip follow the pointer across them. */}
      <ResponsiveContainer width={width || '100%'} height={height - STRIP_BLOCK}>
        <ComposedChart data={model.rows} margin={{ ...CHART_MARGIN, bottom: 8 }} syncId="decision-day">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={C.actual} stopOpacity={AREA_OPACITY} />
              <stop offset="85%" stopColor={C.actual} stopOpacity={0} />
            </linearGradient>
            {/* The P90 buffer as a hatch: reads as uncertainty, and stays amber over the sky fill. */}
            <pattern id={`${gradientId}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={C.forecast} fillOpacity={0.1} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={C.forecast} strokeOpacity={0.5} strokeWidth={1} />
            </pattern>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[model.start, model.end]}
            ticks={model.ticks}
            hide
          />
          <YAxis width={52} domain={[0, yTicks.at(-1)!]} ticks={yTicks} interval={0} tickFormatter={mwNumber} {...AXIS} />
          <Tooltip
            cursor={{ stroke: C.reference, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined
              if (!row) return null
              const rows: TooltipRow[] = [{ color: C.actual, label: 'Actual', value: row.actual !== null ? mw(row.actual) : '—' }]
              if (row.forecast !== null) rows.push({ color: C.forecast, label: 'Forecast', value: mw(row.forecast) })
              const diff = row.forecast !== null && row.actual !== null ? row.forecast - row.actual : null
              return (
                <TooltipCard
                  head={`${ukDay(row.iso)} · ${ukTime(row.iso)} ${ukZone(row.iso)}`}
                  rows={rows}
                  note={
                    diff !== null
                      ? { color: diff > 0 ? C.over : C.under, label: 'Error', value: signedMw(diff) }
                      : { color: C.neutral, label: row.forecastLine !== null ? 'Forecasts are hourly' : 'No forecast', value: '' }
                  }
                />
              )
            }}
          />
          <Area dataKey="actual" type="monotone" stroke="none" fill={`url(#${gradientId})`} activeDot={false} {...animation} />
          {model.p90 !== null && (
            // Knock the sky fill out under the band first, so the two never mix into brown.
            <Area dataKey="band" type="monotone" stroke="none" fill={C.surface} fillOpacity={1} activeDot={false} legendType="none" {...animation} />
          )}
          {model.p90 !== null && (
            <Area dataKey="band" type="monotone" stroke="none" fill={`url(#${gradientId}-hatch)`} fillOpacity={1} activeDot={false} {...animation} />
          )}
          {model.p90 !== null && (
            <Line
              dataKey={(r: Row) => r.band?.[0] ?? null}
              type="monotone"
              stroke={C.forecastEdge}
              strokeWidth={1}
              dot={false}
              activeDot={false}
              legendType="none"
              {...animation}
            />
          )}
          <Line
            dataKey="actual"
            type="monotone"
            stroke={C.actual}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4.5, fill: C.actual, stroke: C.surface, strokeWidth: 2 }}
            {...animation}
          />
          <Line
            dataKey="forecastLine"
            type="monotone"
            stroke={C.forecast}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            dot={false}
            activeDot={false}
            {...animation}
          />
          {/* Hover markers only on real hourly forecasts, never on joined half-hours. */}
          <Line
            dataKey="forecast"
            stroke="none"
            dot={false}
            activeDot={{ r: 4.5, fill: C.forecast, stroke: C.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            legendType="none"
          />
          {runInView && (
            <ReferenceLine
              x={runTime}
              stroke={C.reference}
              strokeDasharray="3 3"
              label={{ value: `Issued ${ukTime(latestRun!)}`, position: 'insideTopLeft', fill: C.secondary, fontSize: 11 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-3 mb-2 flex items-center justify-between gap-4 border-t border-border pt-3 pl-[52px]">
        <p className="text-12 font-medium text-fg-2">Error · forecast − actual</p>
        <Legend
          items={[
            { label: 'Over', color: C.over, kind: 'bar' },
            { label: 'Under', color: C.under, kind: 'bar' },
          ]}
        />
      </div>
      <ResponsiveContainer width={width || '100%'} height={STRIP_H}>
        <ComposedChart data={model.rows} margin={{ ...CHART_MARGIN, top: 8 }} syncId="decision-day">
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[model.start, model.end]}
            ticks={model.ticks}
            tickFormatter={(t: number) => ukTime(new Date(t).toISOString())}
            {...AXIS}
          />
          <YAxis width={52} domain={[errorLo, Math.max(errorHi, errorLo === 0 ? 1 : 0)]} ticks={errorTicks} interval={0} tickFormatter={signedTick} {...AXIS} />
          {/* The main chart's tooltip carries the numbers; this plot only shares the crosshair. */}
          <Tooltip cursor={{ stroke: C.reference, strokeWidth: 1 }} content={() => null} isAnimationActive={false} />
          <ReferenceLine y={0} stroke={C.reference} strokeOpacity={0.6} />
          <Bar dataKey="error" barSize={barSize} radius={2} {...animation}>
            {model.rows.map((r) => (
              <Cell key={r.t} fill={(r.error ?? 0) > 0 ? C.over : C.under} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

function dayTable(model: DayModel): TableSpec {
  return {
    caption: 'Actual and forecast wind generation by half-hour, UK time',
    columns: [
      { key: 'time', label: 'Time' },
      { key: 'actual', label: 'Actual MW', numeric: true },
      { key: 'forecast', label: 'Forecast MW', numeric: true },
      { key: 'diff', label: 'Error MW', numeric: true },
    ],
    rows: model.rows.map((r) => {
      const diff = r.forecast !== null && r.actual !== null ? r.forecast - r.actual : null
      return {
        time: <span className="num">{ukTime(r.iso)}</span>,
        actual: r.actual !== null ? mwNumber(r.actual) : '—',
        forecast: r.forecast !== null ? mwNumber(r.forecast) : '—',
        diff: diff !== null ? { value: signedMw(diff).replace(' MW', ''), tint: diff > 0 ? 'over' : 'under' } : '—',
      }
    }),
  }
}

/* ---------- Side panels ---------- */

function SidePanel({ icon, title, children }: { icon: Glyph; title: string; children: ReactNode }) {
  return (
    <Panel className="p-5">
      <h2 className="mb-4 flex items-center gap-3 text-16 font-semibold text-fg">
        <GlyphBadge glyph={icon} />
        {title}
      </h2>
      {children}
    </Panel>
  )
}

function KeyValues({ items }: { items: { icon: Glyph; label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid gap-3">
      {items.map(({ icon: RowIcon, ...item }) => (
        <div key={item.label} className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-12 text-fg-2">
            <RowIcon size={16} className="text-fg-3" />
            {item.label}
          </dt>
          <dd className="num text-right text-13 font-medium text-fg">
            {item.value}
            {item.hint && <span className="ml-1 text-12 font-normal text-fg-3">{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ForecastUsed({ model, gate, day }: { model: DayModel; gate: Gate; day: string }) {
  const latest = model.runs.at(-1)
  const zone = ukZone(new Date(model.start).toISOString())
  return (
    <SidePanel icon={RunGlyph} title="Forecast used">
      <KeyValues
        items={[
          {
            icon: HourGlyph,
            label: model.runs.length > 1 ? `Issued (latest of ${model.runs.length})` : 'Issued',
            value: latest ? `${ukTime(latest)} ${ukDay(latest)}` : 'None before gate',
            hint: latest ? ukZone(latest) : undefined,
          },
          { icon: GateGlyph, label: 'Gate', value: `${gate} ${shortDay(shiftDay(day, -1))}`, hint: zone },
          {
            icon: HorizonGlyph,
            label: 'Lead',
            value: model.leadMin !== null && model.leadMax !== null ? leadRange(model.leadMin, model.leadMax) : '—',
          },
          {
            icon: CoverageGlyph,
            label: 'Coverage',
            value: `${model.hoursForecast}/${model.hoursTotal} h`,
            hint: model.hoursForecast < model.hoursTotal ? 'gaps left blank' : undefined,
          },
        ]}
      />
    </SidePanel>
  )
}

interface StatProps {
  icon: Glyph
  label: string
  value: number | null
  format?: (n: number) => string
  /** Shown instead of a number when there is none. */
  empty?: string
  unit: string
  tone?: 'over' | 'under'
}

function Stat({ icon: StatIcon, label, value, format = mwNumber, empty = '—', unit, tone }: StatProps) {
  return (
    <div>
      <p className="flex items-center gap-2 text-12 text-fg-2">
        <StatIcon size={17} className="text-fg-3" />
        {label}
      </p>
      <p className="num mt-0.5 flex items-center text-20 font-semibold text-fg">
        {tone && (
          <span aria-hidden="true" className={`mr-2 inline-block size-2 shrink-0 rounded-full ${tone === 'over' ? 'bg-over' : 'bg-under'}`} />
        )}
        {value === null ? empty : <AnimatedNumber value={value} format={format} />}
        <span className="ml-1.5 text-13 font-medium whitespace-nowrap text-fg-3">{unit}</span>
      </p>
    </div>
  )
}

function DaySummary({ model }: { model: DayModel }) {
  return (
    <SidePanel icon={SummaryGlyph} title="Day summary">
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-2 xl:grid-cols-1">
        <Stat icon={MaeGlyph} label="Mean absolute error" value={model.mae} unit="MW" />
        <Stat
          icon={BiasGlyph}
          label="Bias (forecast − actual)"
          value={model.bias}
          format={signedNumber}
          unit="MW"
          tone={model.bias === null ? undefined : model.bias > 0 ? 'over' : 'under'}
        />
        <Stat
          icon={PeakGlyph}
          label="Largest over-forecast"
          value={model.maxOver?.value ?? null}
          empty="None"
          unit={model.maxOver ? `MW at ${ukTime(model.maxOver.iso)}` : ''}
        />
        <Stat icon={BufferGlyph} label="P90 buffer · gate, month" value={model.p90} unit="MW" />
      </div>
    </SidePanel>
  )
}

function Unavailable() {
  return <p className="text-13 text-fg-3">Shown once the day's data loads.</p>
}

// Skeletons share the real panels' row structure and line heights, so nothing moves when data lands.
function ForecastUsedSkeleton() {
  return (
    <SidePanel icon={RunGlyph} title="Forecast used">
      <div className="grid gap-2.5" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-[18px] items-center justify-between gap-4">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-3 w-28" />
          </div>
        ))}
      </div>
    </SidePanel>
  )
}

function DaySummarySkeleton() {
  return (
    <SidePanel icon={SummaryGlyph} title="Day summary">
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-2 xl:grid-cols-1" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <div className="flex h-4 items-center">
              <div className="skeleton h-3 w-28" />
            </div>
            <div className="mt-0.5 flex h-[26px] items-center">
              <div className="skeleton h-5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </SidePanel>
  )
}
