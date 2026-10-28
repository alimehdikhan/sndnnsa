// All display times are UK local (Europe/London), whatever the viewer's own zone.

const ZONE = 'Europe/London'

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' })
const longDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' })
const zoneFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, timeZoneName: 'short' })
const mwFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const gwFmt = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "07:30" */
export const ukTime = (iso: string): string => timeFmt.format(new Date(iso))

/** "Thu 1 Jan" */
export const ukDay = (iso: string): string => dayFmt.format(new Date(iso))

/** "Thu 1 Jan, 07:30" */
export const ukDayTime = (iso: string): string => `${ukDay(iso)}, ${ukTime(iso)}`

/** "Friday 2 January" for a YYYY-MM-DD delivery day (a calendar date, so no zone shift). */
export const longDay = (day: string): string => longDayFmt.format(new Date(`${day}T12:00:00Z`))

/** "GMT" or "BST" for the given instant. */
export const ukZone = (iso: string): string =>
  zoneFmt.formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? 'UK time'

/** "12,345 MW" */
export const mw = (value: number): string => `${mwFmt.format(value)} MW`

/** "12,345" without the unit, for axis ticks and table cells. */
export const mwNumber = (value: number): string => mwFmt.format(value)

/** "+1,234 MW" / "−1,234 MW", with a real minus sign. */
export const signedMw = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${mwFmt.format(Math.abs(value))} MW`

/** "12.3k" style axis ticks in GW for large MW values: 12,000 MW -> "12". */
export const gwTick = (value: number): string => gwFmt.format(value / 1000).replace(/\.0$/, '')

/* ---------- Delivery days (YYYY-MM-DD calendar dates in UK local time) ---------- */

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' })

/**
 * UTC [start, end) of a UK delivery day. London is UTC+0 or UTC+1, and clocks
 * change at 01:00 UTC, so midnight shares the offset of noon the day before.
 */
export function londonDayWindow(day: string): { start: string; end: string } {
  const midnight = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number)
    const noonBefore = Date.UTC(y, m - 1, dd - 1, 12)
    const offsetHours = Number(hourFmt.format(new Date(noonBefore))) - 12
    return new Date(Date.UTC(y, m - 1, dd) - offsetHours * 3_600_000).toISOString()
  }
  return { start: midnight(day), end: midnight(shiftDay(day, 1)) }
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "2–31 January" or "30 December – 5 January" for a span of delivery days. */
export function dayRangeLabel(first: string, last: string): string {
  const a = new Date(`${first}T12:00:00Z`)
  const b = new Date(`${last}T12:00:00Z`)
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${monthFmt.format(b)}`
  }
  return `${a.getUTCDate()} ${monthFmt.format(a)} – ${b.getUTCDate()} ${monthFmt.format(b)}`
}

/** "January 2026" for a delivery day. */
export const monthYear = (day: string): string => monthYearFmt.format(new Date(`${day}T12:00:00Z`))

/** "2026-01-02" shifted by n calendar days. */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Local-midnight Date for a calendar day, as date pickers expect. */
export function dateFromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Calendar day of a date picker's local Date. */
export function dayFromDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "Thu 1 Jan" for a calendar day. */
export const shortDay = (day: string): string => dayFmt.format(new Date(`${day}T12:00:00Z`))

/** Hours between two instants, e.g. lead time from publishTime to startTime. */
export const hoursBetween = (fromIso: string, toIso: string): number =>
  (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000

/** "T+16½–39½ h" for a range of lead times. */
export const leadRange = (min: number, max: number): string => {
  const part = (h: number) => `${Math.floor(h)}${h - Math.floor(h) >= 0.5 ? '½' : ''}`
  return `T+${part(min)}–${part(max)} h`
}

/** "16½ h" / "24 h" */
export const hoursLabel = (hours: number): string => {
  const whole = Math.floor(hours)
  const half = hours - whole >= 0.5
  return `${whole}${half ? '½' : ''} h`
}
