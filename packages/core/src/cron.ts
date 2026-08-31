import cronParser from 'cron-parser'

export function getNextRun(
  expr: string,
  timezone?: string,
): Date {
  const interval = cronParser.parseExpression(expr, {
    tz: timezone,
  })
  return interval.next().toDate()
}

export function shouldRunNow(
  expr: string,
  lastRun: Date | null,
  timezone?: string,
): boolean {
  const interval = cronParser.parseExpression(expr, {
    tz: timezone,
    currentDate: new Date(),
  })

  const prev = interval.prev().toDate()
  const next = interval.next().toDate()
  const now = new Date()

  if (!lastRun) return now >= prev

  return now >= prev && lastRun < prev
}

export function isValidCron(expr: string): boolean {
  try {
    cronParser.parseExpression(expr)
    return true
  } catch {
    return false
  }
}

/**
 * Parse an interval expression like "30m", "2h", "1d" into milliseconds.
 * Returns null if the expression is not a valid interval.
 */
export function parseInterval(expr: string): number | null {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(expr.trim())
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }

  return value * (multipliers[unit] ?? 0)
}

/**
 * Check if an interval-based task should run now.
 * Returns true if lastRun is null or if the interval has elapsed since lastRun.
 */
export function shouldRunInterval(
  expr: string,
  lastRun: Date | null,
): boolean {
  const intervalMs = parseInterval(expr)
  if (intervalMs === null) return false

  if (!lastRun) return true

  return Date.now() - lastRun.getTime() >= intervalMs
}

/**
 * Validate whether an expression is a valid schedule.
 * Accepts both cron expressions and interval expressions.
 */
export function isValidSchedule(type: string, expr: string): boolean {
  if (type === 'cron') return isValidCron(expr)
  if (type === 'interval') return parseInterval(expr) !== null
  if (type === 'once') return expr.trim().length > 0
  if (type === 'at') return !Number.isNaN(new Date(expr).getTime())
  return false
}

// ─── 'at' schedules: start datetime + optional cadence + run cap ──

/** Whether an 'at' schedule is due right now: past its start time,
 *  respecting the repeat cadence and the total-runs cap. */
export function shouldRunAt(
  expr: string,
  interval: string | undefined,
  lastRun: Date | null,
  runCount: number,
  maxRuns?: number,
): boolean {
  const start = new Date(expr).getTime()
  if (Number.isNaN(start)) return false
  if (maxRuns !== undefined && runCount >= maxRuns) return false
  const now = Date.now()
  if (now < start) return false
  if (!interval) return runCount === 0
  const intervalMs = parseInterval(interval)
  if (intervalMs === null) return runCount === 0
  return lastRun === null || now - lastRun.getTime() >= intervalMs
}

/** Whether a schedule has nothing left to run (auto-archive trigger):
 *  always for 'once'; for 'at' when the run cap is reached, or when
 *  there is no repeat cadence and the single run already happened. */
export function isScheduleExhausted(
  schedule: { type: string; interval?: string; maxRuns?: number },
  runCount: number,
): boolean {
  if (schedule.type === 'once') return true
  if (schedule.type === 'at') {
    if (schedule.maxRuns !== undefined) return runCount >= schedule.maxRuns
    return !schedule.interval && runCount >= 1
  }
  return false
}

/** Next scheduled run for an 'at' schedule, or null when finished. */
export function nextAtRun(
  expr: string,
  interval: string | undefined,
  lastRun: Date | null,
): Date | null {
  const start = new Date(expr)
  if (Number.isNaN(start.getTime())) return null
  if (!interval) return start.getTime() > Date.now() ? start : null
  const intervalMs = parseInterval(interval)
  if (intervalMs === null) return start.getTime() > Date.now() ? start : null
  if (!lastRun || lastRun.getTime() < start.getTime()) {
    return start.getTime() > Date.now() ? start : null
  }
  return new Date(lastRun.getTime() + intervalMs)
}

// ─── Human-readable schedule description ────────────────────

/** Structured description of a 5-field cron expression, for UI layers
 *  to render in the user's language. Recognizes the common patterns
 *  the editor generates; anything else falls back to 'custom'. */
export type CronDescription =
  | { kind: 'every-minutes'; minutes: number }
  | { kind: 'every-hours'; hours: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; weekday: number }
  | { kind: 'custom' }

/** Parse helpers for individual cron fields. */
const isStar = (f: string): boolean => f === '*'
const isNum = (f: string): boolean => /^\d+$/.test(f)

export function describeCron(expr: string): CronDescription {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { kind: 'custom' }
  const [m, h, dom, mon, dow] = parts

  // every N minutes: */n * * * *
  if (/^\*\/\d+$/.test(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    const minutes = parseInt(m.slice(2), 10)
    if (minutes > 0) return { kind: 'every-minutes', minutes }
  }
  // every minute: * * * * *
  if (isStar(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'every-minutes', minutes: 1 }
  }
  // every N hours: M */n * * *
  if (isNum(m) && /^\*\/\d+$/.test(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    const hours = parseInt(h.slice(2), 10)
    if (hours > 0) return { kind: 'every-hours', hours }
  }
  // hourly at minute M: M * * * *
  if (isNum(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'every-hours', hours: 1 }
  }
  // daily at HH:MM: M H * * *
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'daily', time: `${h.padStart(2, '0')}:${m.padStart(2, '0')}` }
  }
  // weekdays at HH:MM: M H * * 1-5
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && dow === '1-5') {
    return { kind: 'weekdays', time: `${h.padStart(2, '0')}:${m.padStart(2, '0')}` }
  }
  // weekly on one weekday: M H * * D
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && isNum(dow) && Number(dow) <= 6) {
    return { kind: 'weekly', time: `${h.padStart(2, '0')}:${m.padStart(2, '0')}`, weekday: Number(dow) }
  }
  return { kind: 'custom' }
}
