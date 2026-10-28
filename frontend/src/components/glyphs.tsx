import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * The app's own icon set, drawn for its subjects rather than taken from a general
 * library. One grammar throughout: a 24px grid with 3px of clear space, 1.75 strokes
 * with round caps and joins, and a quiet tinted fill (fill-opacity 0.16) where a shape
 * has a body, so every glyph has the same weight and depth at any size.
 */

export type Glyph = (props: { size?: number; className?: string }) => ReactNode

const TINT = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'none' } as const

function Svg({ size = 18, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {children}
    </svg>
  )
}

/* ---------- Pages ---------- */

/** Decision view: a day's line, with the gate flag that fixes which forecast counts. */
export const DecisionGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 19.5h17" opacity={0.35} />
    <path d="M3.5 16 7.5 12l3.25 2.25L15 9.5l5.5 3.5" />
    <path d="M15 3.5v16" strokeDasharray="0.1 3" />
    <path d="M15 4h4.75l-1.5 2 1.5 2H15z" {...TINT} />
    <path d="M15 4h4.75l-1.5 2 1.5 2H15" />
  </Svg>
)

/** Accuracy view: a gauge reading the month. */
export const AccuracyGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0z" {...TINT} />
    <path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0" />
    <path d="M12 15.25 15.75 9.5" />
    <circle cx="12" cy="15.25" r="1.6" fill="currentColor" stroke="none" />
    <path d="M6.6 11.4l1 .55M12 6.75v1.2M17.4 11.4l-1 .55" opacity={0.55} />
  </Svg>
)

/* ---------- Metrics ---------- */

/** Mean absolute error: the gap between forecast (faint) and actual. */
export const MaeGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 7.5c2.75-2 5.25 2 8.5 0s5.75-2 8.5 0" opacity={0.45} />
    <path d="M3.5 17c2.75-2 5.25 2 8.5 0s5.75-2 8.5 0" />
    <path d="M12 9.25v5.5M10.25 11 12 9.25 13.75 11M10.25 13 12 14.75 13.75 13" />
  </Svg>
)

/** Bias: a beam tipped one way on its fulcrum. */
export const BiasGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M12 14.5 8.75 20h6.5z" {...TINT} />
    <path d="M12 14.5 8.75 20h6.5z" />
    <path d="M3.5 14.25 20.5 9.25" />
    <circle cx="6.5" cy="10.6" r="2.4" {...TINT} />
    <circle cx="6.5" cy="10.6" r="2.4" />
  </Svg>
)

/** P90 buffer: a shield with the level it holds back. */
export const BufferGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M12 3.25 19 5.9v5.35c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V5.9z" {...TINT} />
    <path d="M12 3.25 19 5.9v5.35c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V5.9z" />
    <path d="M8.5 11.25h7" />
    <path d="M9.75 14.5h4.5" opacity={0.5} />
  </Svg>
)

/** Largest over-forecast: a rise to its peak. */
export const PeakGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 17.5 8.5 12.5l3.5 3.5 7.5-7.5" />
    <path d="M14.25 8.5h5.25v5.25" />
    <path d="M3.5 20.5h17" opacity={0.35} />
  </Svg>
)

/* ---------- Chart subjects ---------- */

/** Actual vs forecast generation: two series over a baseline. */
export const SeriesGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 9.5c2.5 0 3.25-3 5.75-3s3.25 2.75 5.75 2.75 3-3 5.5-3" strokeDasharray="2.25 2.5" opacity={0.6} />
    <path d="M3.5 16c2.5 0 3.25-4 5.75-4s3.25 3.5 5.75 3.5 3-3.5 5.5-3.5" />
    <path d="M3.5 20h17" opacity={0.35} />
  </Svg>
)

/** Forecast horizon / lead time: an hourglass, sand mostly run through. */
export const HorizonGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M6.5 3.5h11M6.5 20.5h11" />
    <path d="M8.9 19.4c.7-2.15 2.2-3.35 3.1-4.15.9.8 2.4 2 3.1 4.15z" fill="currentColor" fillOpacity={0.3} stroke="none" />
    <path d="M7.75 3.5c0 4.75 4.25 5.75 4.25 8.5s-4.25 3.75-4.25 8.5M16.25 3.5c0 4.75-4.25 5.75-4.25 8.5s4.25 3.75 4.25 8.5" />
    <path d="M10.4 7.6h3.2" opacity={0.55} />
  </Svg>
)

/** Hour of day: a clock face with its quarter marks. */
export const HourGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" {...TINT} />
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 5.25v1M18.75 12h-1M12 18.75v-1M5.25 12h1" opacity={0.55} />
    <path d="M12 12V8.25M12 12l2.75 1.75" />
  </Svg>
)

/** Forecast vs actual: points about the line of a perfect forecast. */
export const ScatterGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M4 3.5v16.5h16.5" />
    <path d="M6.5 17.5 19.5 4.5" strokeDasharray="0.1 2.75" opacity={0.6} />
    {[
      [8.25, 13.25],
      [10.75, 15.5],
      [11.5, 10.5],
      [14.5, 11.75],
      [15.25, 7.75],
      [17.75, 9.5],
    ].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.35" fill="currentColor" stroke="none" />
    ))}
  </Svg>
)

/** Error distribution: a histogram on its baseline. */
export const HistogramGlyph: Glyph = (p) => (
  <Svg {...p}>
    {[
      [4.5, 15.5],
      [8.75, 9.5],
      [13, 6],
      [17.25, 12.5],
    ].map(([x, y]) => (
      <g key={x}>
        <path d={`M${x} 20v-${20 - y - 1.25}a1.25 1.25 0 0 1 1.25-1.25h0a1.25 1.25 0 0 1 1.25 1.25V20`} {...TINT} />
        <path d={`M${x} 20v-${20 - y - 1.25}a1.25 1.25 0 0 1 1.25-1.25h0a1.25 1.25 0 0 1 1.25 1.25V20`} />
      </g>
    ))}
    <path d="M3 20.25h18" />
  </Svg>
)

/** Worst misses: a warning sign. */
export const AlertGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M10.27 4.4a2 2 0 0 1 3.46 0l7.05 12.25A2 2 0 0 1 19.05 19.65H4.95a2 2 0 0 1-1.73-3z" {...TINT} />
    <path d="M10.27 4.4a2 2 0 0 1 3.46 0l7.05 12.25A2 2 0 0 1 19.05 19.65H4.95a2 2 0 0 1-1.73-3z" />
    <path d="M12 9.25v4" />
    <path d="M12 16.4h.01" strokeWidth={2.25} />
  </Svg>
)

/* ---------- Decision side panels ---------- */

/** The forecast run used: a transmission from its source. */
export const RunGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" opacity={0.5} />
  </Svg>
)

/** Day summary: a card of figures. */
export const SummaryGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.5" {...TINT} />
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.5" />
    <path d="M8 9h8M8 12.5h5" />
    <path d="M8 16h6.5" opacity={0.5} />
  </Svg>
)

/** Gate closure: the lock on what can still be used. */
export const GateGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="5" y="10.25" width="14" height="10" rx="2.75" {...TINT} />
    <rect x="5" y="10.25" width="14" height="10" rx="2.75" />
    <path d="M8.5 10.25V7.75a3.5 3.5 0 0 1 7 0v2.5" />
    <path d="M12 14.25v2" />
  </Svg>
)

/** Coverage: complete. */
export const CoverageGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" {...TINT} />
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.4 12.25 2.4 2.35 4.8-5" />
  </Svg>
)

/* ---------- Selection and data ---------- */

/** What is being scored: a filter. */
export const FilterGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M4 5.25h16l-6.25 7.5v5.5l-3.5 1.75v-7.25z" {...TINT} />
    <path d="M4 5.25h16l-6.25 7.5v5.5l-3.5 1.75v-7.25z" />
  </Svg>
)

/** Pairs of forecast and actual: two overlapping sets. */
export const PairGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="12" r="5.25" {...TINT} />
    <circle cx="15" cy="12" r="5.25" {...TINT} />
    <circle cx="9" cy="12" r="5.25" />
    <circle cx="15" cy="12" r="5.25" />
  </Svg>
)

/** A date window. */
export const CalendarGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="3.75" y="5.25" width="16.5" height="15" rx="3" {...TINT} />
    <rect x="3.75" y="5.25" width="16.5" height="15" rx="3" />
    <path d="M3.75 10h16.5M8.25 3.5v3.5M15.75 3.5v3.5" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" strokeWidth={2.25} />
  </Svg>
)

/** The data snapshot: a stack of stored rows. */
export const DataGlyph: Glyph = (p) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.25" rx="7" ry="2.75" {...TINT} />
    <ellipse cx="12" cy="6.25" rx="7" ry="2.75" />
    <path d="M5 6.25v11.5c0 1.5 3.15 2.75 7 2.75s7-1.25 7-2.75V6.25" />
    <path d="M5 12c0 1.5 3.15 2.75 7 2.75S19 13.5 19 12" opacity={0.55} />
  </Svg>
)

/** Keyboard shortcuts. */
export const KeysGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="2.75" y="5.75" width="18.5" height="12.5" rx="3" {...TINT} />
    <rect x="2.75" y="5.75" width="18.5" height="12.5" rx="3" />
    <path d="M7 9.75h.01M10.33 9.75h.01M13.67 9.75h.01M17 9.75h.01M7 12.75h.01M17 12.75h.01" strokeWidth={2.25} />
    <path d="M9.5 14.75h5" />
  </Svg>
)

/** Where the data comes from: a download from the cloud. */
export const SourceGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M7.25 18.25a4.5 4.5 0 0 1-.55-8.97 5.75 5.75 0 0 1 11.05 1.22 3.9 3.9 0 0 1-.5 7.75" {...TINT} />
    <path d="M7.25 18.25a4.5 4.5 0 0 1-.55-8.97 5.75 5.75 0 0 1 11.05 1.22 3.9 3.9 0 0 1-.5 7.75" />
    <path d="M12 11.5v8M9.5 17l2.5 2.5 2.5-2.5" />
  </Svg>
)

/** Light appearance. */
export const SunGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" {...TINT} />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3.5v1.75M12 18.75v1.75M20.5 12h-1.75M5.25 12H3.5M18 6l-1.25 1.25M7.25 16.75 6 18M18 18l-1.25-1.25M7.25 7.25 6 6" />
  </Svg>
)

/** Dark appearance. */
export const MoonGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M19.75 14.25A8 8 0 1 1 9.75 4.25a6.5 6.5 0 0 0 10 10z" {...TINT} />
    <path d="M19.75 14.25A8 8 0 1 1 9.75 4.25a6.5 6.5 0 0 0 10 10z" />
  </Svg>
)

/** Show or hide the sidebar. */
export const SidebarGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="3" />
    <path d="M3.25 7.25a3 3 0 0 1 3-3H9.5v15.5H6.25a3 3 0 0 1-3-3z" {...TINT} />
    <path d="M9.5 4.25v15.5" />
    <path d="M5.75 8.25h1.25M5.75 11h1.25" opacity={0.6} />
  </Svg>
)

/** Glyph colour roles, matched to the data each one stands for. */
export type GlyphTone = 'neutral' | 'accent' | 'actual' | 'forecast'

/**
 * A glyph on its badge: a softly lit tile tinted by the glyph's role, the way the
 * app icon is lit, so icons read as part of the design rather than dropped in.
 */
export function GlyphBadge({ glyph: G, tone = 'neutral', size = 'md' }: { glyph: Glyph; tone?: GlyphTone; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn(
        'glyph-badge grid shrink-0 place-items-center',
        size === 'sm' && 'size-7 rounded-[8px]',
        size === 'md' && 'size-8 rounded-[9px]',
        size === 'lg' && 'size-11 rounded-[12px]',
      )}
    >
      <G size={size === 'lg' ? 24 : size === 'md' ? 18 : 17} />
    </span>
  )
}
