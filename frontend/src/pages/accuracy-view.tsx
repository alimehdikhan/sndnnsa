import { memo, useId, useMemo, type ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCard, ChartFrame, DataTable, ErrorState, Panel, TooltipCard, type TableSpec } from '@/components/chart-card'
import {
  AccuracyGlyph,
  AlertGlyph,
  BiasGlyph,
  BufferGlyph,
  CalendarGlyph,
  FilterGlyph,
  GlyphBadge,
  HistogramGlyph,
  HorizonGlyph,
  HourGlyph,
  MaeGlyph,
  PairGlyph,
  ScatterGlyph,
  type Glyph,
} from '@/components/glyphs'
import { Segmented, ValueSlider } from '@/components/controls'
import { KpiCard, KpiSkeleton } from '@/components/kpi-card'
import { PageHeader } from '@/components/shell'
import {
  GATES,
  type AccuracySelection,
  type Gate,
  type HorizonSummary,
  type HourSummary,
  type Mode,
  type Pair,
  type Summary,
} from '@/lib/api'
import { AREA_OPACITY, AXIS, C, CHART_MARGIN, GRID, niceTicks } from '@/lib/chart'
import type { Engine, SelectionKey } from '@/lib/engine'
import { hourHover, useHover } from '@/lib/hover'
import { useChartAnimation } from '@/lib/motion'
import { dayRangeLabel, hoursBetween, hoursLabel, leadRange, mw, mwNumber, shiftDay, shortDay, signedMw, ukDayTime, ukZone } from '@/lib/format'
import { useDayRange, useEngine } from '@/lib/queries'

interface Selection {
  mode: Mode
  gate: Gate
  h: number
}

interface AccuracyViewProps {
  /** What the controls show: updates on the same frame as the input. */
  live: Selection
  /** What the charts show: follows `live` in a transition. */
  shown: Selection
  pending: boolean
  onMode: (mode: Mode) => void
  onGate: (gate: Gate) => void
  onH: (h: number) => void
}

export function AccuracyView(props: AccuracyViewProps) {
  const { live, pending } = props
  const { mode, gate, h } = props.shown
  // Every gate and horizon is computed in the browser from the one snapshot, and cached,
  // so the slider and gate switch never wait on the network.
  const dataset = useEngine()
  const range = useDayRange()
  const engine = dataset.data
  const model = useMemo(() => (engine ? buildModel(engine, mode === 'gate' ? { mode, gate } : { mode, h }) : null), [engine, mode, gate, h])
  const loading = !engine && dataset.isFetching
  const error = engine ? undefined : dataset.error?.message

  const hasData = !!model && model.data.summary.n > 0
  const onRetry = dataset.refetch
  const charts = { model, loading, error, onRetry, hasData }

  return (
    <>
      <PageHeader
        icon={AccuracyGlyph}
        title="Accuracy view"
        description={`How far the forecast missed across ${range ? dayRangeLabel(range.first, range.last) : 'the snapshot'}, by horizon, hour of day and size of error.`}
        controls={
          <>
            <Segmented
              label="Score by"
              options={[
                { value: 'gate', label: 'Gate closure' },
                { value: 'horizon', label: 'Horizon' },
              ]}
              value={live.mode}
              onChange={props.onMode}
            />
            {live.mode === 'gate' ? (
              <Segmented
                label="Gate · day before, UK"
                options={GATES.map((g) => ({ value: g, label: g }))}
                value={live.gate}
                onChange={props.onGate}
              />
            ) : (
              <ValueSlider
                label="Published at least"
                value={live.h}
                min={0}
                max={48}
                format={(v) => `${v} h`}
                describe={(v) => `${v} hours ahead`}
                onChange={props.onH}
              />
            )}
          </>
        }
      />

      <SelectionStrip model={model} mode={mode} gate={gate} h={h} />

      {error && !loading && !model ? (
        <Panel className="p-4">
          <ErrorState height={320} message={error} onRetry={() => void onRetry()} />
        </Panel>
      ) : (
        <div className="view grid grid-cols-12 gap-6" data-pending={pending}>
          <Kpis model={model} />
          <HorizonCard {...charts} mode={mode} h={h} />
          <HourCard {...charts} />
          <ScatterCard {...charts} />
          <HistogramCard {...charts} />
          <WorstMisses model={model} />
        </div>
      )}
    </>
  )
}

/* ---------- Model ---------- */

interface Bin {
  center: number
  count: number
}

interface ScatterPoint {
  startTime: string
  actual: number
  forecast: number
  error: number
}

interface AccuracyModel {
  data: {
    mode: Mode
    gate: Gate | null
    start: string
    end: string
    coverage: AccuracySelection['coverage']
    summary: Summary
    byHour: HourSummary[]
    byHorizon: HorizonSummary[]
    worst: Pair[]
  }
  leadMin: number | null
  leadMax: number | null
  bins: Bin[]
  binWidth: number
  scatterMax: number
  over: ScatterPoint[]
  under: ScatterPoint[]
}

const HALF_HOUR = 30 * 60 * 1000

/** Shape one gate's or horizon's scores for the cards. */
function buildModel(engine: Engine, key: SelectionKey): AccuracyModel {
  const sel: AccuracySelection = engine.accuracy(key)
  const view = { mode: key.mode, gate: key.mode === 'gate' ? key.gate : null, start: engine.meta.start, end: engine.meta.end, byHorizon: engine.byHorizon() }
  const start = new Date(view.start).getTime()
  const points: ScatterPoint[] = sel.scatter.map(([slot, actual, forecast]) => ({
    startTime: new Date(start + slot * HALF_HOUR).toISOString(),
    actual,
    forecast,
    error: forecast - actual,
  }))
  const peak = Math.max(0, ...points.flatMap((p) => [p.actual, p.forecast]))
  return {
    data: {
      mode: view.mode,
      gate: view.gate,
      start: view.start,
      end: view.end,
      coverage: sel.coverage,
      summary: sel.summary,
      byHour: sel.byHour,
      byHorizon: view.byHorizon,
      worst: sel.worst,
    },
    leadMin: sel.leadMin,
    leadMax: sel.leadMax,
    bins: sel.histogram,
    binWidth: sel.binWidth,
    scatterMax: Math.ceil(peak / 2500) * 2500,
    over: points.filter((p) => p.error > 0),
    under: points.filter((p) => p.error <= 0),
  }
}

const zoneOf = (model: AccuracyModel | null) => (model ? ukZone(model.data.start) : 'GMT')

interface CardProps {
  model: AccuracyModel | null
  loading: boolean
  error?: string
  onRetry: () => void
  hasData: boolean
}

/* ---------- Selection strip (what is being scored) ---------- */

function SelectionStrip({ model, mode, gate, h }: { model: AccuracyModel | null; mode: Mode; gate: Gate; h: number }) {
  const d = model?.data
  const items: { icon: Glyph; label: string; value: ReactNode }[] = [
    { icon: FilterGlyph, label: 'Scoring', value: mode === 'gate' ? `Latest run before ${gate}, day before` : `Latest run ≥ ${h} h ahead` },
    {
      icon: HorizonGlyph,
      label: 'Lead',
      value: model?.leadMin != null && model.leadMax != null ? leadRange(model.leadMin, model.leadMax) : '—',
    },
    {
      icon: PairGlyph,
      label: 'Paired',
      value: d ? `${d.coverage.pairs.toLocaleString('en-GB')} of ${d.coverage.rows.toLocaleString('en-GB')} half-hours` : '—',
    },
    {
      icon: CalendarGlyph,
      label: 'Window',
      value: d ? `${shortDay(d.start.slice(0, 10))} – ${shortDay(shiftDay(d.end.slice(0, 10), -1))} ${d.end.slice(0, 4)} ${zoneOf(model)}` : '—',
    },
  ]
  return (
    <dl className="mb-6 flex flex-wrap items-center gap-2" aria-label="Forecasts scored">
      {items.map(({ icon: ItemIcon, label, value }) => (
        <div key={label} className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface pr-3 pl-2.5 shadow-card">
          <ItemIcon size={16} className="text-fg-3" />
          <dt className="text-12 text-fg-2">{label}</dt>
          <dd className="num text-13 font-medium text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ---------- KPIs ---------- */

const signedNumber = (n: number) => signedMw(n).replace(' MW', '')

const Kpis = memo(function Kpis({ model }: { model: AccuracyModel | null }) {
  const cell = 'col-span-12 md:col-span-4'
  if (!model) {
    return [0, 1, 2].map((i) => (
      <div key={i} className={cell}>
        <KpiSkeleton />
      </div>
    ))
  }
  const s = model.data.summary
  const byHour = model.data.byHour
  const pct = s.nmae != null ? `${Math.round(s.nmae * 100)}% of mean actual output` : 'No forecast–actual pairs'
  return (
    <>
      <div className={cell}>
        <KpiCard
          icon={MaeGlyph}
          tone="actual"
          label="Mean absolute error"
          value={s.mae}
          formatValue={mwNumber}
          unit="MW"
          context={pct}
          spark={byHour.map((r) => r.mae)}
          sparkColor={C.actual}
          sparkLabel="Mean absolute error by hour of day"
          format={mw}
        />
      </div>
      <div className={cell}>
        <KpiCard
          icon={BiasGlyph}
          tone="forecast"
          label="Bias"
          value={s.bias}
          formatValue={signedNumber}
          unit="MW"
          context={s.bias == null ? 'No forecast–actual pairs' : s.bias > 0 ? 'Forecast runs high' : 'Forecast runs low'}
          spark={byHour.map((r) => r.bias)}
          sparkColor={s.bias != null && s.bias < 0 ? C.under : C.over}
          sparkLabel="Bias by hour of day"
          format={signedMw}
          signed
        />
      </div>
      <div className={cell}>
        <KpiCard
          icon={BufferGlyph}
          tone="forecast"
          label="P90 buffer"
          value={s.p90Over}
          formatValue={mwNumber}
          unit="MW"
          context={s.nOver > 0 ? `90% of over-forecasts below this · ${s.nOver}/${s.n} h over` : 'No hour was over-forecast'}
          spark={byHour.map((r) => r.p90Over)}
          sparkColor={C.over}
          sparkLabel="P90 buffer by hour of day"
          format={mw}
        />
      </div>
    </>
  )
})

/* ---------- Error by horizon ---------- */

const HorizonCard = memo(function HorizonCard(props: CardProps & { mode: Mode; h: number }) {
  const { model, mode, h } = props
  const animation = useChartAnimation('accuracy-horizon', !!model)
  const fillId = useId().replace(/:/g, '')
  const rows = model?.data.byHorizon ?? []
  const yTicks = niceTicks(Math.max(0, ...rows.flatMap((r) => [r.mae ?? 0, r.p90Over ?? 0])))
  const lead =
    model && model.leadMin !== null && model.leadMax !== null
      ? [Math.max(0, model.leadMin), Math.min(48, model.leadMax)]
      : null
  const last = rows.at(-1)

  return (
    <ChartCard
      className="col-span-12 xl:col-span-8"
      icon={HorizonGlyph}
      title="Error by horizon"
      subtitle="Latest forecast published at least h hours ahead · MW"
      legend={[
        { label: 'MAE', color: C.actual, kind: 'line' },
        { label: 'P90 buffer', color: C.over, kind: 'line' },
        mode === 'gate'
          ? { label: `${model?.data.gate ?? ''} gate leads`, color: C.band, kind: 'band' }
          : { label: `Selected ${h}h`, color: C.reference, kind: 'line' },
      ]}
      loading={props.loading}
      error={props.error}
      onRetry={props.onRetry}
      hasData={rows.some((r) => r.n > 0)}
      height={300}
      skeleton="line"
      table={horizonTable(rows)}
    >
      <ChartFrame>
        <ComposedChart data={rows} margin={{ ...CHART_MARGIN, top: 20, right: 64 }}>
          <defs>
            <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={C.actual} stopOpacity={AREA_OPACITY} />
              <stop offset="100%" stopColor={C.actual} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          {mode === 'gate' && lead && (
            <ReferenceArea
              x1={lead[0]}
              x2={lead[1]}
              fill={C.band}
              fillOpacity={1}
              stroke="none"
              ifOverflow="hidden"
              label={{ value: 'Gate leads', position: 'insideTop', offset: -14, fill: C.muted, fontSize: 11 }}
            />
          )}
          {mode === 'gate' && lead && lead.map((x) => <ReferenceLine key={x} x={x} stroke={C.reference} strokeOpacity={0.6} strokeDasharray="2 4" />)}
          <XAxis
            dataKey="horizonH"
            type="number"
            domain={[0, 48]}
            ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
            tickFormatter={(v: number) => `${v}h`}
            {...AXIS}
          />
          <YAxis width={52} domain={[0, yTicks.at(-1)!]} ticks={yTicks} tickFormatter={mwNumber} {...AXIS} />
          <Tooltip
            cursor={{ stroke: C.reference, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = active ? (payload?.[0]?.payload as HorizonSummary | undefined) : undefined
              if (!r) return null
              return (
                <TooltipCard
                  head={`Published ≥ ${r.horizonH}h ahead`}
                  rows={[
                    { color: C.actual, label: 'MAE', value: r.mae != null ? mw(r.mae) : '—' },
                    { color: C.over, label: 'P90 buffer', value: r.p90Over != null ? mw(r.p90Over) : '—' },
                  ]}
                  note={{ color: C.neutral, label: 'Pairs', value: String(r.n) }}
                />
              )
            }}
          />
          {mode === 'horizon' && (
            <ReferenceLine
              x={h}
              stroke={C.reference}
              label={{ value: `${h}h`, position: 'insideTopRight', fill: C.secondary, fontSize: 11 }}
            />
          )}
          <Area
            dataKey="mae"
            type="monotone"
            stroke={C.actual}
            strokeWidth={2.25}
            fill={`url(#${fillId})`}
            dot={false}
            activeDot={{ r: 4.5, fill: C.actual, stroke: C.surface, strokeWidth: 2 }}
            {...animation}
          >
            {/* Direct end labels: the second cue alongside colour for this pair. */}
            <LabelList dataKey="mae" content={(p) => endLabel(p, last?.horizonH, 'MAE')} />
          </Area>
          <Line dataKey="p90Over" type="monotone" stroke={C.over} strokeWidth={2.25} dot={false} activeDot={{ r: 4.5, fill: C.over, stroke: C.surface, strokeWidth: 2 }} {...animation}>
            <LabelList dataKey="p90Over" content={(p) => endLabel(p, last?.horizonH, 'P90')} />
          </Line>
        </ComposedChart>
      </ChartFrame>
    </ChartCard>
  )
})

function endLabel(props: { x?: number | string; y?: number | string; index?: number; value?: unknown }, lastH: number | undefined, text: string) {
  if (lastH === undefined || props.index !== lastH - 1 || props.x == null || props.y == null) return null
  return (
    <text x={Number(props.x) + 8} y={Number(props.y)} dy={4} fill={C.secondary} fontSize={11}>
      {text}
    </text>
  )
}

function horizonTable(rows: HorizonSummary[]): TableSpec {
  return {
    caption: 'Mean absolute error and P90 buffer by forecast horizon',
    columns: [
      { key: 'h', label: 'Horizon h', numeric: true },
      { key: 'mae', label: 'MAE MW', numeric: true },
      { key: 'p90', label: 'P90 buffer MW', numeric: true },
      { key: 'n', label: 'Pairs', numeric: true },
    ],
    rows: rows.map((r) => ({
      h: r.horizonH,
      mae: r.mae != null ? mwNumber(r.mae) : '—',
      p90: r.p90Over != null ? mwNumber(r.p90Over) : '—',
      n: r.n,
    })),
  }
}

/* ---------- Error by hour of day ---------- */

const pad = (n: number) => String(n).padStart(2, '0')

const HourCard = memo(function HourCard(props: CardProps) {
  const animation = useChartAnimation('accuracy-hour', !!props.model)
  const zone = zoneOf(props.model)
  const rows = props.model?.data.byHour ?? []
  const yTicks = niceTicks(Math.max(0, ...rows.map((r) => r.mae ?? 0)))
  const peak = rows.reduce<(typeof rows)[number] | null>((best, r) => (r.mae != null && (!best || r.mae > (best.mae ?? 0)) ? r : best), null)
  const mean = props.model?.data.summary.mae ?? null
  // Hovering a KPI sparkline highlights the same hour here, and the reverse.
  const hovered = useHover(hourHover)
  return (
    <ChartCard
      className="col-span-12 xl:col-span-4"
      icon={HourGlyph}
      title="Error by hour of day"
      subtitle={`Mean absolute error · MW · UK hour (${zone})`}
      legend={[
        { label: peak ? `Worst ${pad(peak.hour)}:00` : 'Worst hour', color: C.actual, kind: 'bar' },
        { label: 'Mean', color: C.reference, kind: 'dashed' },
      ]}
      loading={props.loading}
      error={props.error}
      onRetry={props.onRetry}
      hasData={props.hasData}
      height={300}
      skeleton="bars"
      empty={{ title: 'No forecast–actual pairs for this selection' }}
      table={{
        caption: 'Mean absolute error and bias by hour of day',
        columns: [
          { key: 'hour', label: `Hour ${zone}` },
          { key: 'mae', label: 'MAE MW', numeric: true },
          { key: 'bias', label: 'Bias MW', numeric: true },
          { key: 'n', label: 'Pairs', numeric: true },
        ],
        rows: rows.map((r) => ({
          hour: <span className="num">{`${pad(r.hour)}:00`}</span>,
          mae: r.mae != null ? mwNumber(r.mae) : '—',
          bias: r.bias != null ? { value: signedMw(r.bias).replace(' MW', ''), tint: r.bias > 0 ? 'over' : 'under' } : '—',
          n: r.n,
        })),
      }}
    >
      <ChartFrame>
        <BarChart
          data={rows}
          margin={CHART_MARGIN}
          barCategoryGap="20%"
          onMouseMove={(state) => hourHover.set(state.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex))}
          onMouseLeave={() => hourHover.set(null)}
        >
          <CartesianGrid {...GRID} />
          <XAxis dataKey="hour" interval={0} tickFormatter={(v: number) => (v % 3 === 0 ? pad(v) : '')} {...AXIS} />
          <YAxis width={52} domain={[0, yTicks.at(-1)!]} ticks={yTicks} tickFormatter={mwNumber} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const r = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined
              if (!r) return null
              return (
                <TooltipCard
                  head={`${pad(r.hour)}:00–${pad((r.hour + 1) % 24)}:00 ${zone}`}
                  rows={[{ color: C.actual, label: 'MAE', value: r.mae != null ? mw(r.mae) : '—' }]}
                  note={
                    r.bias != null
                      ? { color: r.bias > 0 ? C.over : C.under, label: 'Bias', value: signedMw(r.bias) }
                      : undefined
                  }
                />
              )
            }}
          />
          <Bar dataKey="mae" maxBarSize={18} radius={[4, 4, 0, 0]} {...animation}>
            {rows.map((r) => (
              <Cell key={r.hour} fill={r.hour === peak?.hour ? C.actual : r.hour === hovered ? C.neutralStrong : C.neutral} />
            ))}
          </Bar>
          {mean != null && <ReferenceLine y={mean} stroke={C.reference} strokeDasharray="4 4" ifOverflow="extendDomain" />}
        </BarChart>
      </ChartFrame>
    </ChartCard>
  )
})

/* ---------- Forecast vs actual ---------- */

const ScatterCard = memo(function ScatterCard(props: CardProps) {
  const { model } = props
  const max = model?.scatterMax ?? 25000
  const ticks = niceTicks(max).filter((t) => t <= max)
  const tooltip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }): ReactNode => {
    const p = active ? (payload?.[0]?.payload as ScatterPoint | undefined) : undefined
    if (!p) return null
    return (
      <TooltipCard
        head={`${ukDayTime(p.startTime)} ${ukZone(p.startTime)}`}
        rows={[
          { color: C.forecast, label: 'Forecast', value: mw(p.forecast) },
          { color: C.actual, label: 'Actual', value: mw(p.actual) },
        ]}
        note={{ color: p.error > 0 ? C.over : C.under, label: 'Error', value: signedMw(p.error) }}
      />
    )
  }
  return (
    <ChartCard
      className="col-span-12 lg:col-span-5"
      icon={ScatterGlyph}
      title="Forecast vs actual"
      subtitle="Forecast (up) against actual (across) · one point per hour · MW"
      legend={[
        { label: 'Over', color: C.over, kind: 'dot' },
        { label: 'Under', color: C.under, kind: 'dot' },
      ]}
      loading={props.loading}
      error={props.error}
      onRetry={props.onRetry}
      hasData={props.hasData}
      height={340}
      // Plot area = width - 66 by height - 52; equal keeps y = x at 45°.
      heightFor={(width) => Math.min(Math.max(width - 14, 260), 420)}
      skeleton="scatter"
      empty={{ title: 'No forecast–actual pairs for this selection' }}
    >
      <ChartFrame>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 16, left: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="actual"
            type="number"
            domain={[0, max]}
            ticks={ticks}
            tickFormatter={mwNumber}
            label={{ value: 'Actual MW', position: 'insideBottom', offset: -12 }}
            {...AXIS}
          />
          <YAxis
            dataKey="forecast"
            type="number"
            domain={[0, max]}
            ticks={ticks}
            tickFormatter={mwNumber}
            width={54}
            {...AXIS}
          />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: max, y: max },
            ]}
            stroke={C.reference}
            strokeDasharray="4 4"
          />
          <ReferenceDot x={max * 0.03} y={max * 0.97} r={0} label={{ value: 'Forecast too high', position: 'right', fill: C.muted, fontSize: 11 }} />
          <ReferenceDot x={max * 0.97} y={max * 0.03} r={0} label={{ value: 'Forecast too low', position: 'left', fill: C.muted, fontSize: 11 }} />
          <Tooltip cursor={false} isAnimationActive={false} content={tooltip} />
          <Scatter data={model?.over ?? []} shape={<Dot color={C.over} />} isAnimationActive={false} />
          <Scatter data={model?.under ?? []} shape={<Dot color={C.under} />} isAnimationActive={false} />
        </ScatterChart>
      </ChartFrame>
    </ChartCard>
  )
})

/** A small point, slightly see-through so dense clusters read darker; its transparent stroke is a 24px hit area. */
function Dot(props: { cx?: number; cy?: number; color: string }) {
  if (props.cx == null || props.cy == null) return null
  return (
    <circle cx={props.cx} cy={props.cy} r={2.75} fill={props.color} fillOpacity={0.78} stroke="transparent" strokeWidth={19} />
  )
}

/* ---------- Error histogram ---------- */

const HistogramCard = memo(function HistogramCard(props: CardProps) {
  const { model } = props
  const animation = useChartAnimation('accuracy-histogram', !!model)
  const bins = model?.bins ?? []
  const binWidth = model?.binWidth ?? 500
  const half = binWidth / 2
  const p90 = model?.data.summary.p90Over ?? null
  const lo = bins.length ? bins[0].center - half : -half
  const hi = bins.length ? bins[bins.length - 1].center + half : half
  const ticks: number[] = []
  for (let t = Math.ceil(lo / 2000) * 2000; t <= hi; t += 2000) ticks.push(t)
  const yTicks = niceTicks(Math.max(1, ...bins.map((b) => b.count)))
  const color = (center: number) => (center > 0 ? C.over : center < 0 ? C.under : C.neutral)

  return (
    <ChartCard
      className="col-span-12 lg:col-span-7"
      icon={HistogramGlyph}
      title="Error distribution"
      subtitle={`Hours per ${mwNumber(binWidth)} MW band of forecast − actual`}
      legend={[
        { label: 'Over', color: C.over, kind: 'bar' },
        { label: '±250', color: C.neutral, kind: 'bar' },
        { label: 'Under', color: C.under, kind: 'bar' },
      ]}
      loading={props.loading}
      error={props.error}
      onRetry={props.onRetry}
      hasData={props.hasData}
      height={340}
      heightFor={(width) => Math.min(Math.max(Math.round(width * 0.6), 260), 420)}
      skeleton="histogram"
      empty={{ title: 'No forecast–actual pairs for this selection' }}
      table={{
        caption: 'Number of hours in each error band',
        columns: [
          { key: 'band', label: 'Forecast − actual MW' },
          { key: 'count', label: 'Hours', numeric: true },
        ],
        rows: bins.map((b) => ({
          band: (
            <span className="num">
              {signedMw(b.center - half).replace(' MW', '')} to {signedMw(b.center + half).replace(' MW', '')}
            </span>
          ),
          count: b.count,
        })),
      }}
    >
      <ChartFrame>
        <BarChart data={bins} margin={{ top: 16, right: 8, bottom: 16, left: 0 }} barCategoryGap={2}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="center"
            type="number"
            domain={[lo, hi]}
            ticks={ticks}
            tickFormatter={(v: number) => signedMw(v).replace(' MW', '')}
            label={{ value: 'Forecast − actual MW', position: 'insideBottom', offset: -12 }}
            {...AXIS}
          />
          <YAxis width={40} domain={[0, yTicks.at(-1)!]} ticks={yTicks} allowDecimals={false} {...AXIS} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const b = active ? (payload?.[0]?.payload as Bin | undefined) : undefined
              if (!b) return null
              return (
                <TooltipCard
                  head={`${signedMw(b.center - half)} to ${signedMw(b.center + half)}`}
                  rows={[{ color: color(b.center), label: 'Hours', value: String(b.count) }]}
                />
              )
            }}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} {...animation}>
            {bins.map((b) => (
              <Cell key={b.center} fill={color(b.center)} />
            ))}
          </Bar>
          {p90 !== null && (
            <ReferenceLine
              x={p90}
              stroke={C.over}
              strokeDasharray="4 4"
              label={{ value: `P90 ${signedMw(p90).replace(' MW', '')}`, position: 'insideTopRight', fill: C.secondary, fontSize: 11 }}
            />
          )}
        </BarChart>
      </ChartFrame>
    </ChartCard>
  )
})

/* ---------- Worst misses ---------- */

const WORST_COLUMNS = [
  { key: 'rank', label: '#' },
  { key: 'time', label: 'Delivery (UK)' },
  { key: 'forecast', label: 'Forecast MW', numeric: true },
  { key: 'actual', label: 'Actual MW', numeric: true },
  { key: 'error', label: 'Error MW', numeric: true },
  { key: 'share', label: 'Of actual', numeric: true },
  { key: 'run', label: 'Forecast issued' },
  { key: 'lead', label: 'Lead', numeric: true },
]

const WorstMisses = memo(function WorstMisses({ model }: { model: AccuracyModel | null }) {
  const worst = model?.data.worst ?? []
  return (
    <Panel className="col-span-12">
      <header className="flex items-start gap-3 px-5 pt-5">
        <GlyphBadge glyph={AlertGlyph} tone="forecast" />
        <div className="min-w-0">
          <h2 className="text-16 font-semibold text-fg">Worst misses</h2>
          <p className="mt-0.5 text-13 text-fg-2">The five hours with the largest absolute error · UK time ({zoneOf(model)})</p>
        </div>
      </header>
      <div className="px-5 pt-4 pb-5">
        {!model ? (
          <TableSkeleton rows={5} />
        ) : worst.length === 0 ? (
          <p className="grid h-[236px] place-items-center rounded-[8px] bg-hover text-13 text-fg-2">
            No forecast–actual pairs for this selection
          </p>
        ) : (
          <DataTable
            spec={{
              caption: 'The five largest forecast errors',
              columns: WORST_COLUMNS,
              rows: worst.map((p, i) => ({
                rank: (
                  <span className="num grid size-6 place-items-center rounded-full bg-hover text-12 font-semibold text-fg-2">{i + 1}</span>
                ),
                time: <span className="num font-medium">{ukDayTime(p.startTime)}</span>,
                forecast: mwNumber(p.forecast),
                actual: mwNumber(p.actual),
                error: { value: signedMw(p.error).replace(' MW', ''), tint: p.error > 0 ? 'over' : 'under' },
                share: <span className="text-fg-2">{p.actual > 0 ? `${p.error > 0 ? '+' : '−'}${Math.round((Math.abs(p.error) / p.actual) * 100)}%` : '—'}</span>,
                run: <span className="num text-fg-2">{ukDayTime(p.publishTime)}</span>,
                lead: `T+${hoursLabel(hoursBetween(p.publishTime, p.startTime))}`,
              })),
            }}
          />
        )}
      </div>
    </Panel>
  )
})

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true">
      <div className="flex h-9 items-center gap-6 border-b border-border px-3">
        {WORST_COLUMNS.map((c) => (
          <div key={c.key} className="skeleton h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-b border-border px-3 last:border-0">
          {WORST_COLUMNS.map((c) => (
            <div key={c.key} className="skeleton h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
