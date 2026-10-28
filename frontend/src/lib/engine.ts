// Selections and metrics computed in the browser from one snapshot (GET /api/dataset),
// so no interaction needs a request. These mirror backend/app/selection.py,
// metrics.py and views.py rule for rule, and return the same shapes as the API's
// /api/view/* responses. tests/engine.test.ts replays the backend's own answers
// (tests/fixtures/engine.json, from backend/scripts/export_engine_fixture.py) so the
// two can't drift.

import type { AccuracySelection, ActualPoint, DecisionView, ForecastPoint, Gate, HorizonSummary, HourSummary, Meta, Pair, Summary } from '@/lib/api'

export interface DatasetSnapshot {
  version: string
  start: string
  end: string
  refreshedAt: string | null
  /** Seconds since `start`. */
  actualTimes: number[]
  actualMw: (number | null)[]
  /** Per run: publish time and [first target, MW per consecutive hour] segments, all in seconds since `start`. */
  runs: { publish: number; segments: [number, (number | null)[]][] }[]
}

export const BIN_WIDTH = 500
const MAX_SCATTER_POINTS = 1500
const HOUR = 3_600_000
const HALF_HOUR = 1_800_000
const DAY = 86_400_000

/** Accuracy for one gate, or one horizon in hours. */
export type SelectionKey = { mode: 'gate'; gate: Gate } | { mode: 'horizon'; h: number }

export class Engine {
  readonly start: number
  readonly end: number
  readonly meta: Meta & { version: string }

  // Actuals, ascending by time; NaN where missing.
  private readonly actT: Float64Array
  private readonly actMw: Float64Array
  // Forecast rows grouped by target time (ascending), each group ascending by publish time.
  private readonly targetT: Float64Array
  private readonly groupFrom: Int32Array
  private readonly pub: Float64Array
  private readonly mw: Float64Array
  private readonly group = new Map<number, number>()
  private readonly memo = new Map<string, unknown>()

  constructor(snap: DatasetSnapshot) {
    this.start = Date.parse(snap.start)
    this.end = Date.parse(snap.end)
    const at = (seconds: number) => this.start + seconds * 1000

    this.actT = Float64Array.from(snap.actualTimes, at)
    this.actMw = Float64Array.from(snap.actualMw, (v) => v ?? NaN)

    const rows: { t: number; p: number; v: number }[] = []
    for (const run of snap.runs) {
      for (const [first, values] of run.segments) {
        values.forEach((v, i) => rows.push({ t: at(first + 3600 * i), p: at(run.publish), v: v ?? NaN }))
      }
    }
    // Stable: equal publish times keep snapshot order, and the last one wins, as in pandas.
    rows.sort((a, b) => a.t - b.t || a.p - b.p)
    this.pub = Float64Array.from(rows, (r) => r.p)
    this.mw = Float64Array.from(rows, (r) => r.v)
    const targets: number[] = []
    const from: number[] = []
    rows.forEach((r, i) => {
      if (i === 0 || r.t !== rows[i - 1].t) {
        this.group.set(r.t, targets.length)
        targets.push(r.t)
        from.push(i)
      }
    })
    from.push(rows.length)
    this.targetT = Float64Array.from(targets)
    this.groupFrom = Int32Array.from(from)

    this.meta = {
      version: snap.version,
      start: snap.start,
      end: snap.end,
      refreshedAt: snap.refreshedAt,
      actualRows: this.actT.length,
      forecastRuns: new Set(snap.runs.map((r) => r.publish)).size,
    }
  }

  /* ---------- Selection (app/selection.py) ---------- */

  /** Index of the latest forecast for target `t` published before `cutoff` (or at it, if inclusive); -1 if none. */
  private pick(t: number, cutoff: number, inclusive: boolean): number {
    const g = this.group.get(t)
    if (g === undefined) return -1
    let lo = this.groupFrom[g]
    let hi = this.groupFrom[g + 1]
    const first = lo
    // First index whose publish time is past the cutoff; the one before it is the latest eligible.
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const p = this.pub[mid]
      if (inclusive ? p <= cutoff : p < cutoff) lo = mid + 1
      else hi = mid
    }
    return lo > first ? lo - 1 : -1
  }

  /** latest_at_gate's cutoff: `gate` (UK time) on the day before t's UK delivery day. */
  private gateCutoff(t: number, gate: Gate): number {
    const local = new Date(t + londonOffset(t))
    const key = `${gate}|${local.getUTCFullYear()}-${local.getUTCMonth()}-${local.getUTCDate()}`
    let cutoff = this.memo.get(key) as number | undefined
    if (cutoff === undefined) {
      const [hh, mm] = gate.split(':').map(Number)
      cutoff = fromLondonWallClock(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - 1, hh, mm))
      this.memo.set(key, cutoff)
    }
    return cutoff
  }

  private select(t: number, key: SelectionKey): number {
    return key.mode === 'gate' ? this.pick(t, this.gateCutoff(t, key.gate), false) : this.pick(t, t - key.h * HOUR, true)
  }

  /* ---------- Scoring (app/metrics.py) ---------- */

  /** Selection over every actual's startTime, joined to the actuals. */
  private evaluate(key: SelectionKey): Evaluation {
    const id = key.mode === 'gate' ? `eval|g|${key.gate}` : `eval|h|${key.h}`
    return this.cached(id, () => {
      const n = this.actT.length
      let missingForecast = 0
      let missingActual = 0
      const pairs: Scored[] = []
      for (let j = 0; j < n; j++) {
        const t = this.actT[j]
        const k = this.select(t, key)
        const forecast = k < 0 ? NaN : this.mw[k]
        const actual = this.actMw[j]
        if (Number.isNaN(forecast)) missingForecast++
        if (Number.isNaN(actual)) missingActual++
        if (!Number.isNaN(forecast) && !Number.isNaN(actual)) {
          pairs.push({ t, publish: this.pub[k], forecast, actual, error: forecast - actual })
        }
      }
      return { coverage: { rows: n, missingForecast, missingActual, pairs: pairs.length }, pairs }
    })
  }

  /** error_by_horizon(): summarise() per horizon 1-48 h, scored on every actual. */
  byHorizon(): HorizonSummary[] {
    return this.cached('by-horizon', () => {
      const rows: HorizonSummary[] = []
      for (let h = 1; h <= 48; h++) rows.push({ horizonH: h, ...summarise(this.evaluate({ mode: 'horizon', h }).pairs) })
      return rows
    })
  }

  /* ---------- Page bundles (app/views.py) ---------- */

  /** The Accuracy view's data for one gate or horizon (views.accuracy_selection). */
  accuracy(key: SelectionKey): AccuracySelection {
    const id = key.mode === 'gate' ? `acc|g|${key.gate}` : `acc|h|${key.h}`
    return this.cached(id, () => {
      const ev = this.evaluate(key)
      const { pairs } = ev
      let leadMin = Infinity
      let leadMax = -Infinity
      for (const p of pairs) {
        const lead = (p.t - p.publish) / HOUR
        if (lead < leadMin) leadMin = lead
        if (lead > leadMax) leadMax = lead
      }
      const step = Math.max(1, Math.ceil(pairs.length / MAX_SCATTER_POINTS))
      const scatter: [number, number, number][] = []
      for (let i = 0; i < pairs.length; i += step) {
        const p = pairs[i]
        scatter.push([roundHalfEven((p.t - this.start) / HALF_HOUR), roundHalfEven(p.actual), roundHalfEven(p.forecast)])
      }
      return {
        key: key.mode === 'gate' ? key.gate : String(key.h),
        coverage: ev.coverage,
        summary: summarise(pairs),
        byHour: byHour(pairs),
        worst: worst(pairs, 5),
        leadMin: pairs.length ? leadMin : null,
        leadMax: pairs.length ? leadMax : null,
        binWidth: BIN_WIDTH,
        histogram: histogram(pairs),
        scatter,
        scatterTotal: pairs.length,
      }
    })
  }

  /** Everything the Decision view draws for one UK delivery day and gate (views.decision_view). */
  decision(day: string, gate: Gate): DecisionView {
    return this.cached(`dec|${day}|${gate}`, () => {
      const [y, m, d] = day.split('-').map(Number)
      const start = fromLondonWallClock(Date.UTC(y, m - 1, d))
      const end = fromLondonWallClock(Date.UTC(y, m - 1, d + 1))

      const forecast: ForecastPoint[] = []
      const withForecast: { t: number; publish: number; value: number }[] = []
      for (let g = lowerBound(this.targetT, start); g < this.targetT.length && this.targetT[g] < end; g++) {
        const t = this.targetT[g]
        const k = this.pick(t, this.gateCutoff(t, gate), false)
        const value = k < 0 ? NaN : this.mw[k]
        forecast.push({ startTime: iso(t), publishTime: k < 0 ? null : iso(this.pub[k]), generation: Number.isNaN(value) ? null : value })
        if (k >= 0 && !Number.isNaN(value)) withForecast.push({ t, publish: this.pub[k], value })
      }

      const actuals: ActualPoint[] = []
      const actualAt = new Map<number, number>()
      for (let j = lowerBound(this.actT, start); j < this.actT.length && this.actT[j] < end; j++) {
        const v = this.actMw[j]
        actuals.push({ startTime: iso(this.actT[j]), generation: Number.isNaN(v) ? null : v })
        actualAt.set(this.actT[j], v)
      }

      let leadMin = Infinity
      let leadMax = -Infinity
      let absSum = 0
      let sum = 0
      let count = 0
      let maxOver: DecisionView['kpis']['maxOver'] = null
      for (const f of withForecast) {
        const lead = (f.t - f.publish) / HOUR
        leadMin = Math.min(leadMin, lead)
        leadMax = Math.max(leadMax, lead)
        const actual = actualAt.get(f.t)
        if (actual === undefined || Number.isNaN(actual)) continue
        const error = f.value - actual
        absSum += Math.abs(error)
        sum += error
        count++
        // idxmax: the first of equal maxima.
        if (error > 0 && (maxOver === null || error > maxOver.value)) maxOver = { value: error, startTime: iso(f.t) }
      }

      return {
        day,
        gate,
        start: iso(start),
        end: iso(end),
        actuals,
        forecast,
        runs: [...new Set(withForecast.map((f) => f.publish))].sort((a, b) => a - b).map(iso),
        leadMin: withForecast.length ? leadMin : null,
        leadMax: withForecast.length ? leadMax : null,
        hoursForecast: withForecast.length,
        hoursTotal: forecast.length,
        kpis: {
          mae: count ? absSum / count : null,
          bias: count ? sum / count : null,
          maxOver,
          p90Over: this.accuracy({ mode: 'gate', gate }).summary.p90Over,
        },
      }
    })
  }

  /** UK delivery days lying wholly inside the snapshot (views.delivery_days). */
  days(): string[] {
    return this.cached('days', () => {
      const local = (t: number) => new Date(t + londonOffset(t))
      const first = local(this.start)
      const firstDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + (isMidnight(first) ? 0 : 1))
      const last = local(this.end)
      const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() - 1)
      const days: string[] = []
      for (let t = firstDay; t <= lastDay; t += DAY) days.push(new Date(t).toISOString().slice(0, 10))
      return days
    })
  }

  private cached<T>(key: string, compute: () => T): T {
    if (this.memo.has(key)) return this.memo.get(key) as T
    const value = compute()
    this.memo.set(key, value)
    return value
  }
}

/* ---------- Metrics on scored pairs ---------- */

interface Scored {
  t: number
  publish: number
  forecast: number
  actual: number
  error: number
}

interface Evaluation {
  coverage: AccuracySelection['coverage']
  pairs: Scored[]
}

/** summarise(): NaN-free metrics become null where undefined, as the API sends them. */
function summarise(pairs: Scored[]): Summary {
  const n = pairs.length
  if (n === 0) {
    return { n: 0, mae: null, rmse: null, bias: null, nmae: null, p50Abs: null, p90Abs: null, p95Abs: null, nOver: 0, p90Over: null }
  }
  const abs = new Float64Array(n)
  const over: number[] = []
  let absSum = 0
  let sqSum = 0
  let sum = 0
  let actualSum = 0
  pairs.forEach((p, i) => {
    abs[i] = Math.abs(p.error)
    absSum += abs[i]
    sqSum += p.error * p.error
    sum += p.error
    actualSum += p.actual
    if (p.error > 0) over.push(p.error)
  })
  abs.sort()
  const mae = absSum / n
  const meanActual = actualSum / n
  return {
    n,
    mae,
    rmse: Math.sqrt(sqSum / n),
    bias: sum / n,
    nmae: meanActual > 0 ? mae / meanActual : null,
    p50Abs: quantile(abs, 0.5),
    p90Abs: quantile(abs, 0.9),
    p95Abs: quantile(abs, 0.95),
    nOver: over.length,
    p90Over: over.length ? quantile(Float64Array.from(over).sort(), 0.9) : null,
  }
}

/** numpy's default (linear) quantile of sorted values, with its rounding-stable lerp. */
function quantile(sorted: Float64Array, q: number): number {
  const position = (sorted.length - 1) * q
  const lo = Math.floor(position)
  const hi = Math.min(lo + 1, sorted.length - 1)
  const t = position - lo
  const a = sorted[lo]
  const b = sorted[hi]
  const diff = b - a
  return t >= 0.5 ? b - diff * (1 - t) : a + diff * t
}

/** error_by_hour(): every UK hour 0-23, n=0 where there are no pairs. */
function byHour(pairs: Scored[]): HourSummary[] {
  const groups: Scored[][] = Array.from({ length: 24 }, () => [])
  for (const p of pairs) groups[londonHour(p.t)].push(p)
  return groups.map((g, hour) => ({ hour, ...summarise(g) }))
}

/** worst_misses(): largest absolute error first; ties go to the earlier startTime. */
function worst(pairs: Scored[], count: number): Pair[] {
  return [...pairs]
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error) || a.t - b.t)
    .slice(0, count)
    .map((p) => ({
      startTime: iso(p.t),
      publishTime: iso(p.publish),
      forecast: p.forecast,
      actual: p.actual,
      error: p.error,
      absError: Math.abs(p.error),
    }))
}

/** Counts per BIN_WIDTH band centred on zero; the zero bin is always present. */
function histogram(pairs: Scored[]): AccuracySelection['histogram'] {
  if (pairs.length === 0) return []
  const bins = pairs.map((p) => Math.floor(p.error / BIN_WIDTH + 0.5))
  const lo = Math.min(0, ...bins)
  const hi = Math.max(0, ...bins)
  const counts = new Array<number>(hi - lo + 1).fill(0)
  for (const k of bins) counts[k - lo]++
  return counts.map((count, i) => ({ center: (lo + i) * BIN_WIDTH, count }))
}

/* ---------- Time ---------- */

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
})
const offsets = new Map<number, number>()

/** London's offset from UTC at an instant, in ms. Clocks change on the hour, so it's cached per UTC hour. */
function londonOffset(t: number): number {
  const bucket = Math.floor(t / HOUR)
  let offset = offsets.get(bucket)
  if (offset === undefined) {
    const at = bucket * HOUR
    const p = Object.fromEntries(londonParts.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]))
    offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at
    offsets.set(bucket, offset)
  }
  return offset
}

/** The UTC instant of a London wall-clock time, given as if it were UTC (tz_localize). */
function fromLondonWallClock(wall: number): number {
  const guess = wall - londonOffset(wall)
  return wall - londonOffset(guess)
}

function londonHour(t: number): number {
  return new Date(t + londonOffset(t)).getUTCHours()
}

function isMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
}

/** ISO 8601 UTC as the API writes it: "2026-01-12T07:30:00Z". */
function iso(t: number): string {
  return new Date(t).toISOString().replace('.000Z', 'Z')
}

function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** numpy's round(): halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}
