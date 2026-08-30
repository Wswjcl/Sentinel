// Schedule helpers for the renderer: cron description rendering and
// next-run preview. The description parsing mirrors core's describeCron
// (the renderer cannot import @sentinel/core runtime - node:fs), and
// next-run uses cron-parser, the same library core uses.
import cronParser from 'cron-parser'

export type CronDescription =
  | { kind: 'every-minutes'; minutes: number }
  | { kind: 'every-hours'; hours: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; weekday: number }
  | { kind: 'custom' }

const isStar = (f: string): boolean => f === '*'
const isNum = (f: string): boolean => /^\d+$/.test(f)

export function describeCron(expr: string): CronDescription {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { kind: 'custom' }
  const [m, h, dom, mon, dow] = parts
  const time = (hh: string, mm: string): string =>
    `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`

  if (/^\*\/\d+$/.test(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    const minutes = parseInt(m.slice(2), 10)
    if (minutes > 0) return { kind: 'every-minutes', minutes }
  }
  if (isStar(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'every-minutes', minutes: 1 }
  }
  if (isNum(m) && /^\*\/\d+$/.test(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    const hours = parseInt(h.slice(2), 10)
    if (hours > 0) return { kind: 'every-hours', hours }
  }
  // hourly at minute M: M * * * *
  if (isNum(m) && isStar(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'every-hours', hours: 1 }
  }
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && isStar(dow)) {
    return { kind: 'daily', time: time(h, m) }
  }
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && dow === '1-5') {
    return { kind: 'weekdays', time: time(h, m) }
  }
  if (isNum(m) && isNum(h) && isStar(dom) && isStar(mon) && isNum(dow) && Number(dow) <= 6) {
    return { kind: 'weekly', time: time(h, m), weekday: Number(dow) }
  }
  return { kind: 'custom' }
}

/** Next run for a cron expression, null when invalid. */
export function nextCronRun(expr: string, timezone?: string): Date | null {
  try {
    return cronParser.parseExpression(expr, { tz: timezone }).next().toDate()
  } catch {
    return null
  }
}

/** Localized weekday name (0 = Sunday). */
export function weekdayName(weekday: number, locale: string): string {
  // 2023-01-01 was a Sunday
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
    new Date(2023, 0, 1 + weekday),
  )
}

/** Localized one-line description of a schedule. */
export function describeScheduleText(
  type: 'cron' | 'interval' | 'once',
  expr: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
): string {
  if (type === 'once') return t('schedule.descOnce')
  if (type === 'interval') {
    const match = /^(\d+)\s*(m|h|d)$/.exec(expr.trim())
    if (!match) return expr
    const n = match[1]
    const unit = match[2] === 'm' ? t('schedule.unitMinutes') : match[2] === 'h' ? t('schedule.unitHours') : t('schedule.unitDays')
    return t('schedule.descEveryN', { n, unit })
  }
  const desc = describeCron(expr)
  switch (desc.kind) {
    case 'every-minutes':
      return desc.minutes === 1
        ? t('schedule.descEveryMinute')
        : t('schedule.descEveryN', { n: desc.minutes, unit: t('schedule.unitMinutes') })
    case 'every-hours':
      return t('schedule.descEveryN', { n: desc.hours, unit: t('schedule.unitHours') })
    case 'daily':
      return t('schedule.descDaily', { time: desc.time })
    case 'weekdays':
      return t('schedule.descWeekdays', { time: desc.time })
    case 'weekly':
      return t('schedule.descWeekly', { day: weekdayName(desc.weekday, locale), time: desc.time })
    default:
      return expr
  }
}
