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
