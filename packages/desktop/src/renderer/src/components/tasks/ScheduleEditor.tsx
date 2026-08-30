import { useI18n } from '../../hooks/useI18n'
import { describeCron, describeScheduleText, nextCronRun } from '../../lib/schedule'

export interface ScheduleValue {
  type: 'cron' | 'interval' | 'once'
  expr: string
  timezone?: string
}

interface ScheduleEditorProps {
  value: ScheduleValue
  onChange: (v: ScheduleValue) => void
}

const inputCls = `bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`

interface QuickChip {
  key: string
  value: ScheduleValue
}

const CHIPS: QuickChip[] = [
  { key: 'every15m', value: { type: 'cron', expr: '*/15 * * * *' } },
  { key: 'hourly', value: { type: 'cron', expr: '0 * * * *' } },
  { key: 'daily', value: { type: 'cron', expr: '0 9 * * *' } },
  { key: 'weekdays', value: { type: 'cron', expr: '0 9 * * 1-5' } },
  { key: 'weekly', value: { type: 'cron', expr: '0 9 * * 1' } },
  { key: 'once', value: { type: 'once', expr: 'now' } },
]

function sameSchedule(a: ScheduleValue, b: ScheduleValue): boolean {
  return a.type === b.type && a.expr.trim() === b.expr.trim()
}

/** Schedule editor: quick-pace chips, structured inputs for the common
 *  patterns, a validated custom cron input, timezone and a live preview
 *  (plain-language description + next run). */
export default function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  const { t, locale } = useI18n()

  const cronDesc = value.type === 'cron' ? describeCron(value.expr) : null
  const cronValid = value.type === 'cron' ? nextCronRun(value.expr, value.timezone) !== null : true
  const nextRun = value.type === 'cron' && cronValid
    ? nextCronRun(value.expr, value.timezone)
    : null

  const activeChip = value.type === 'once'
    ? 'once'
    : CHIPS.find((c) => c.key !== 'once' && sameSchedule(c.value, value))?.key

  const setCron = (expr: string): void => onChange({ ...value, type: 'cron', expr })

  const timeOf = (expr: string, fallback = '09:00'): string => {
    const desc = describeCron(expr)
    return desc.kind === 'daily' || desc.kind === 'weekdays' || desc.kind === 'weekly'
      ? desc.time
      : fallback
  }

  const setTime = (time: string, dow: string | null): void => {
    const [hh, mm] = time.split(':')
    if (!hh || !mm) return
    setCron(`${Number(mm)} ${Number(hh)} * * ${dow ?? '*'}`)
  }

  const intervalMatch = value.type === 'interval'
    ? /^(\d+)\s*(m|h|d)$/.exec(value.expr.trim())
    : null
  const intervalValue = intervalMatch
    ? { n: intervalMatch[1], unit: intervalMatch[2] }
    : { n: '30', unit: 'm' }

  const setInterval = (n: string, unit: string): void => {
    const num = Math.max(1, parseInt(n, 10) || 1)
    onChange({ ...value, type: 'interval', expr: `${num}${unit}` })
  }

  const chipCls = (active: boolean): string =>
    `px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
      active
        ? 'bg-[var(--color-blue)] text-white'
        : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
    }`

  return (
    <div className="space-y-2">
      {/* Quick pace chips */}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange({ ...chip.value, timezone: value.timezone })}
            className={chipCls(activeChip === chip.key)}
          >
            {t(`schedule.chip.${chip.key}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, type: 'cron', expr: value.type === 'cron' ? value.expr : '*/30 * * * *' })}
          className={chipCls(value.type === 'cron' && activeChip === undefined)}
        >
          {t('schedule.chip.custom')}
        </button>
      </div>

      {/* Structured editors for the active pattern */}
      {value.type === 'cron' && (cronDesc?.kind === 'daily' || activeChip === 'daily') && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          {t('schedule.dailyTime')}
          <input
            type="time"
            value={timeOf(value.expr)}
            onChange={(e) => setTime(e.target.value, null)}
            className={`${inputCls} font-mono`}
          />
        </div>
      )}
      {value.type === 'cron' && (cronDesc?.kind === 'weekdays' || activeChip === 'weekdays') && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          {t('schedule.weekdaysTime')}
          <input
            type="time"
            value={timeOf(value.expr)}
            onChange={(e) => setTime(e.target.value, '1-5')}
            className={`${inputCls} font-mono`}
          />
        </div>
      )}
      {value.type === 'cron' && (cronDesc?.kind === 'weekly' || activeChip === 'weekly') && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          {t('schedule.weeklyTime')}
          <select
            value={cronDesc?.kind === 'weekly' ? cronDesc.weekday : 1}
            onChange={(e) => setTime(timeOf(value.expr), e.target.value)}
            className={inputCls}
          >
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <option key={d} value={d}>
                {t(`schedule.weekday.${d}`)}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={timeOf(value.expr)}
            onChange={(e) => setTime(e.target.value, String(cronDesc?.kind === 'weekly' ? cronDesc.weekday : 1))}
            className={`${inputCls} font-mono`}
          />
        </div>
      )}
      {value.type === 'interval' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          {t('schedule.everyLabel')}
          <input
            type="number"
            min={1}
            value={intervalValue.n}
            onChange={(e) => setInterval(e.target.value, intervalValue.unit)}
            className={`${inputCls} w-20`}
          />
          <select
            value={intervalValue.unit}
            onChange={(e) => setInterval(intervalValue.n, e.target.value)}
            className={inputCls}
          >
            <option value="m">{t('schedule.unitMinutes')}</option>
            <option value="h">{t('schedule.unitHours')}</option>
            <option value="d">{t('schedule.unitDays')}</option>
          </select>
        </div>
      )}
      {value.type === 'cron' && activeChip === undefined && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)] shrink-0">cron</span>
          <input
            type="text"
            value={value.expr}
            onChange={(e) => setCron(e.target.value)}
            placeholder="*/30 * * * *"
            className={`${inputCls} font-mono flex-1 ${!cronValid ? 'border-[var(--color-red)]' : ''}`}
          />
        </div>
      )}
      {value.type === 'once' && (
        <p className="text-xs text-[var(--color-text-dim)]">{t('schedule.onceDesc')}</p>
      )}
      {value.type === 'cron' && !cronValid && (
        <p className="text-xs text-[var(--color-red)]">{t('schedule.invalidCron')}</p>
      )}

      {/* Timezone + preview */}
      {value.type !== 'once' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          {t('schedule.timezone')}
          <select
            value={value.timezone ?? ''}
            onChange={(e) => onChange({ ...value, timezone: e.target.value || undefined })}
            className={inputCls}
          >
            <option value="">{t('schedule.tzSystem')}</option>
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      )}
      {cronValid && (
        <div className="bg-[var(--color-hover)]/60 border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs space-y-0.5">
          <div className="text-[var(--color-text)]">
            <span className="text-[var(--color-text-muted)]">{t('schedule.previewMeaning')}</span>
            {' '}
            {describeScheduleText(value.type, value.expr, t, locale)}
          </div>
          {nextRun && (
            <div className="text-[var(--color-text-dim)]">
              {t('schedule.previewNext')}
              {nextRun.toLocaleString(locale)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
