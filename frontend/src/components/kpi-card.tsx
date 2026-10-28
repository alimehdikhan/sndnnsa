import { useId, useState, type PointerEvent } from 'react'
import { AnimatedNumber } from '@/components/animated-number'
import { GlyphBadge, type Glyph, type GlyphTone } from '@/components/glyphs'
import { Panel } from '@/components/chart-card'
import { AREA_OPACITY, C } from '@/lib/chart'
import { hourHover, useHover } from '@/lib/hover'
import { useWidth } from '@/lib/use-width'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  icon: Glyph
  /** The badge's tint: the series colour the metric belongs to. */
  tone: GlyphTone
  label: string
  /** Counts to each new value rather than jumping. */
  value: number | null
  formatValue: (value: number) => string
  unit: string
  context: string
  /** Metric by UK hour of day (0-23); nulls are gaps. */
  spark: (number | null)[]
  sparkColor: string
  sparkLabel: string
  /** Formats one hour's value, unit included, for the caption and hover readout. */
  format: (value: number) => string
  /** Signed metric (bias): bars either side of zero, coloured by sign. */
  signed?: boolean
}

const SPARK_H = 44
const CARD_H = 'h-[224px]'

const hourLabel = (i: number) => `${String(i).padStart(2, '0')}:00`

export function KpiCard(props: KpiCardProps) {
  const { spark, format } = props
  // Shared with the other KPI sparklines and the error-by-hour chart.
  const hover = useHover(hourHover)
  const worst = worstIndex(spark)
  const shown = hover !== null && spark[hover] != null ? hover : null
  const caption =
    shown !== null
      ? `${hourLabel(shown)} · ${format(spark[shown] as number)}`
      : worst !== null
        ? `Worst ${hourLabel(worst)}`
        : ''

  return (
    <Panel className={cn('flex flex-col p-5', CARD_H)}>
      <h2 className="flex min-w-0 items-center gap-2.5 text-13 font-medium text-fg-2">
        <GlyphBadge glyph={props.icon} tone={props.tone} size="sm" />
        <span className="truncate">{props.label}</span>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="num mt-2 text-36 font-semibold text-fg">
          {props.value === null ? '—' : <AnimatedNumber value={props.value} format={props.formatValue} />}
          <span className="ml-1.5 text-16 font-medium text-fg-3">{props.unit}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-13 text-fg-2">{props.context}</p>
        <HourSpark
          values={spark}
          color={props.sparkColor}
          signed={props.signed}
          worst={worst}
          hover={shown}
          onHover={hourHover.set}
          caption={caption}
          active={shown !== null}
          label={
            worst !== null
              ? `${props.sparkLabel}. Worst hour ${hourLabel(worst)}: ${format(spark[worst] as number)}.`
              : props.sparkLabel
          }
        />
      </div>
    </Panel>
  )
}

export function KpiSkeleton() {
  return (
    <Panel className={cn('flex flex-col p-5', CARD_H)} aria-hidden="true">
      <div className="flex h-[18px] items-center">
        <div className="skeleton h-3.5 w-32" />
      </div>
      <div className="skeleton mt-3 h-9 w-36" />
      <div className="skeleton mt-2 h-3 w-44" />
      <div className="skeleton mt-auto h-[62px] w-full" />
    </Panel>
  )
}

/** Hour with the largest magnitude; for bias that's the furthest from zero either way. */
function worstIndex(values: (number | null)[]): number | null {
  let best: number | null = null
  values.forEach((v, i) => {
    if (v !== null && (best === null || Math.abs(v) > Math.abs(values[best] as number))) best = i
  })
  return best
}

interface HourSparkProps {
  values: (number | null)[]
  color: string
  signed?: boolean
  worst: number | null
  hover: number | null
  onHover: (index: number | null) => void
  /** Worst hour, or the hovered hour's value, shown between the axis ends. */
  caption: string
  active: boolean
  label: string
}

/** Full-width hour-of-day trend: an area for magnitudes, diverging bars for signed values. */
function HourSpark({ values, color, signed, worst, hover, onHover, caption, active, label }: HourSparkProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const gradient = useId()
  const n = values.length
  const known = values.filter((v): v is number => v !== null)

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!w || n === 0) return
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    const i = signed ? Math.floor((x / w) * n) : Math.round(((x - PAD) / (w - 2 * PAD)) * (n - 1))
    onHover(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <div className="mt-auto pt-3">
      <div
        ref={setEl}
        className="relative cursor-crosshair touch-none"
        style={{ height: SPARK_H }}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => onHover(null)}
      >
        {w > 0 && known.length >= 2 && (
          <svg width={w} height={SPARK_H} role="img" aria-label={label} className="block overflow-visible">
            {signed ? (
              <Bars values={values} w={w} worst={worst} hover={hover} />
            ) : (
              <Area values={values} w={w} color={color} gradient={gradient} worst={worst} hover={hover} />
            )}
          </svg>
        )}
      </div>
      <div className="num mt-1.5 grid grid-cols-[auto_1fr_auto] items-baseline gap-2 text-11 text-fg-3">
        <span aria-hidden="true">00:00</span>
        <span className={cn('truncate text-center text-12', active ? 'font-medium text-fg' : 'text-fg-2')} aria-live="polite">
          {caption}
        </span>
        <span aria-hidden="true">23:00</span>
      </div>
    </div>
  )
}

const PAD = 4

function Area(props: { values: (number | null)[]; w: number; color: string; gradient: string; worst: number | null; hover: number | null }) {
  const { values, w, color, gradient, worst, hover } = props
  const hi = Math.max(...values.map((v) => v ?? 0)) || 1
  const base = SPARK_H - 0.5
  const x = (i: number) => PAD + (i / (values.length - 1)) * (w - 2 * PAD)
  const y = (v: number) => base - (v / hi) * (SPARK_H - PAD * 2)

  // One line and one filled area per run of consecutive known hours, so gaps stay gaps.
  const runs: number[][] = []
  values.forEach((v, i) => {
    if (v === null) return
    if (i > 0 && values[i - 1] !== null) runs[runs.length - 1].push(i)
    else runs.push([i])
  })
  const line = runs.map((run) => run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`).join('')).join('')
  const area = runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const top = run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`).join('')
      return `${top}L${x(run.at(-1) as number).toFixed(1)},${base}L${x(run[0]).toFixed(1)},${base}Z`
    })
    .join('')
  const marker = hover ?? worst

  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={AREA_OPACITY} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={base} y2={base} stroke={C.grid} strokeWidth="1" />
      <path d={area} fill={`url(#${gradient})`} />
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={base} stroke={C.reference} strokeWidth="1" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {marker !== null && values[marker] !== null && (
        <circle cx={x(marker)} cy={y(values[marker] as number)} r="4" fill={color} stroke={C.surface} strokeWidth="2" />
      )}
    </>
  )
}

function Bars(props: { values: (number | null)[]; w: number; worst: number | null; hover: number | null }) {
  const { values, w, worst, hover } = props
  const lo = Math.min(0, ...values.map((v) => v ?? 0))
  const hi = Math.max(0, ...values.map((v) => v ?? 0))
  const span = hi - lo || 1
  // 6px headroom either side for the worst-hour marker.
  const y = (v: number) => 6 + ((hi - v) / span) * (SPARK_H - 12)
  const zero = y(0)
  const band = w / values.length
  const barW = Math.max(1, band - 3)
  const radius = Math.min(2, barW / 2)

  return (
    <>
      <line x1="0" x2={w} y1={zero} y2={zero} stroke={C.grid} strokeWidth="1" />
      {values.map((v, i) => {
        if (v === null || v === 0) return null
        const top = Math.min(y(v), zero)
        const height = Math.max(1, Math.abs(y(v) - zero))
        // Solid by default; while hovering, every other hour steps back to neutral.
        const fill = hover === null || i === hover ? (v > 0 ? C.over : C.under) : C.neutral
        return <rect key={i} x={i * band + 1.5} y={top} width={barW} height={height} rx={radius} fill={fill} />
      })}
      {hover === null && worst !== null && values[worst] !== null && (
        <circle
          cx={worst * band + band / 2}
          cy={(values[worst] as number) > 0 ? y(values[worst] as number) - 4 : y(values[worst] as number) + 4}
          r="1.75"
          fill={C.secondary}
        />
      )}
    </>
  )
}
