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
  return false
}
