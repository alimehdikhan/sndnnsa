// Types mirror backend/app/schemas.py. Times are ISO 8601 UTC strings ("...Z").

export const GATES = ['09:20', '09:50', '15:30'] as const

export type Gate = (typeof GATES)[number]
export type Mode = 'gate' | 'horizon'

export interface Meta {
  start: string
  end: string
  refreshedAt: string | null
  actualRows: number
  forecastRuns: number
}

export interface ActualPoint {
  startTime: string
  generation: number | null
}

export interface ForecastPoint {
  startTime: string
  publishTime: string | null // null where no forecast was eligible
  generation: number | null
}

export interface ActualsResponse {
  start: string
  end: string
  points: ActualPoint[]
}

export interface GateForecastResponse {
  day: string
  gate: Gate
  start: string
  end: string
  points: ForecastPoint[]
}

export interface Summary {
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
  nmae: number | null
  p50Abs: number | null
  p90Abs: number | null
  p95Abs: number | null
  nOver: number
  p90Over: number | null
}

export interface HourSummary extends Summary {
  hour: number
}

export interface HorizonSummary extends Summary {
  horizonH: number
}

export interface Pair {
  startTime: string
  publishTime: string
  forecast: number
  actual: number
  error: number
  absError: number
}

export interface MetricsResponse {
  mode: Mode
  gate: Gate | null
  h: number | null
  start: string
  end: string
  coverage: { rows: number; missingForecast: number; missingActual: number; pairs: number }
  summary: Summary
  byHour: HourSummary[]
  byHorizon: HorizonSummary[]
  worst: Pair[]
  pairs: Pair[]
}

/* ---------- Page bundles (computed in the browser by lib/engine.ts; same shapes as /api/view/*) ---------- */

export interface DecisionView {
  day: string
  gate: Gate
  start: string
  end: string
  actuals: ActualPoint[]
  forecast: ForecastPoint[]
  runs: string[] // publishTimes of the forecast runs used
  leadMin: number | null
  leadMax: number | null
  hoursForecast: number
  hoursTotal: number
  kpis: {
    mae: number | null
    bias: number | null
    maxOver: { value: number; startTime: string } | null
    p90Over: number | null // month-wide P90 over-forecast for this gate
  }
}

export interface AccuracySelection {
  key: string // the gate, or the horizon in hours
  coverage: MetricsResponse['coverage']
  summary: Summary
  byHour: HourSummary[]
  worst: Pair[]
  leadMin: number | null
  leadMax: number | null
  binWidth: number
  histogram: { center: number; count: number }[]
  /** [half-hours since `start`, actual MW, forecast MW]; at most 1,500 points. */
  scatter: [number, number, number][]
  scatterTotal: number
}

export interface AccuracyView {
  mode: Mode
  gate: Gate | null
  start: string
  end: string
  byHorizon: HorizonSummary[]
  /** mode=gate: one selection. mode=horizon: 49, indexed by horizon 0-48. */
  selections: AccuracySelection[]
}

/**
 * The static build (`npm run build:static`, deployed to Vercel) has no API: it reads the
 * same snapshot from a file shipped alongside the app.
 */
export const STATIC = import.meta.env.MODE === 'static'

/** Request paths. The UI needs only the snapshot; it computes every view from it. */
export const paths = {
  dataset: STATIC ? '/snapshot.json' : '/api/dataset',
}

export class ApiError extends Error {}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { signal })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError('Could not reach the API. Is the backend running (make dev)?')
  }
  if (!response.ok) {
    throw new ApiError(await errorMessage(response))
  }
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    // FastAPI validation errors: { detail: [{ loc: ["query", "day"], msg: "..." }] }
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      const { loc, msg } = body.detail[0]
      return `${Array.isArray(loc) ? loc.at(-1) : 'request'}: ${msg}`
    }
    if (typeof body?.detail === 'string') return body.detail
  } catch {
    // not JSON; fall through
  }
  if (response.status >= 500) {
    return `The API isn't responding (${response.status}). Check the backend is running: make dev`
  }
  return `The API returned ${response.status} ${response.statusText}`.trim()
}
