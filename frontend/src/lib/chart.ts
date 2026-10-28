// Recharts takes colours as SVG attributes; CSS variables resolve there too, so
// charts follow the theme without re-rendering. Values live in styles/tokens.css.
export const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  forecastBand: 'var(--series-forecast-subtle)',
  forecastEdge: 'var(--series-forecast-edge)',
  band: 'var(--chart-band)',
  over: 'var(--error-over)',
  under: 'var(--error-under)',
  neutral: 'var(--chart-neutral)',
  neutralStrong: 'var(--chart-neutral-strong)',
  grid: 'var(--chart-grid)',
  reference: 'var(--chart-reference)',
  surface: 'var(--surface)',
  raised: 'var(--surface-raised)',
  muted: 'var(--text-muted)',
  secondary: 'var(--text-secondary)',
} as const

/** Opacity at the top of area gradients; lighter in the light theme. */
export const AREA_OPACITY = 'var(--chart-area-opacity)'

/** Default Recharts chrome off: no axis or tick lines, ticks styled in index.css. */
export const AXIS = { axisLine: false, tickLine: false, tickMargin: 8 } as const
export const GRID = { stroke: C.grid, vertical: false } as const
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const

/** Round 0-based ticks (1-2-2.5-5 steps, at most five intervals) covering `max`. */
export function niceTicks(max: number): number[] {
  const steps = [1, 2, 2.5, 5].flatMap((s) => [s, s * 10, s * 100, s * 1000, s * 10000]).sort((a, b) => a - b)
  const step = steps.find((s) => Math.ceil(max / s) <= 5) ?? 10000
  const top = Math.max(1, Math.ceil(max / step))
  return Array.from({ length: top + 1 }, (_, i) => i * step)
}
