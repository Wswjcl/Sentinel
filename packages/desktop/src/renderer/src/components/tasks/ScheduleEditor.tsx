import { useEffect, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { zonedWallToUtcIso, utcIsoToZonedWall } from '../../lib/schedule'

export interface ScheduleValue {
  type: 'cron' | 'interval' | 'once' | 'at'
  expr: string
  timezone?: string
  interval?: string
  maxRuns?: number
}

interface ScheduleEditorProps {
  value: ScheduleValue
  onChange: (v: ScheduleValue) => void
}

const inputCls = `bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`
const labelCls = 'text-xs text-[var(--color-text-muted)] shrink-0'

/** Default start: the next 5-minute boundary at least 1 hour away. */
function defaultStartWall(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

interface AtState {
  wall: string
  repeat: boolean
  n: string
  unit: 'm' | 'h' | 'd'
  limited: boolean
  maxRuns: string
}

function stateFromValue(value: ScheduleValue): AtState {
  const intervalMatch =
    value.interval != null ? /^(\d+)\s*(m|h|d)$/.exec(value.interval.trim()) : null
  return {
    wall: value.type === 'at' ? utcIsoToZonedWall(value.expr, value.timezone) || defaultStartWall() : defaultStartWall(),
    repeat: intervalMatch != null,
    n: intervalMatch?.[1] ?? '30',
    unit: (intervalMatch?.[2] as 'm' | 'h' | 'd') ?? 'm',
    limited: value.maxRuns !== undefined,
    maxRuns: value.maxRuns !== undefined ? String(value.maxRuns) : '10',
  }
}

function emit(value: ScheduleValue, s: AtState, timezone?: string): ScheduleValue {
  const expr = zonedWallToUtcIso(s.wall, timezone)
  return {
    type: 'at',
    expr,
    timezone,
    interval: s.repeat ? `${Math.max(1, parseInt(s.n, 10) || 1)}${s.unit}` : undefined,
    maxRuns: s.repeat && s.limited ? Math.max(1, parseInt(s.maxRuns, 10) || 1) : undefined,
  }
}

/** Schedule editor (v2): pick a start datetime, an optional repeat
 *  cadence and an optional run cap - no cron syntax required. Existing
 *  cron/interval/once tasks keep working but new tasks use 'at'. */
export default function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  const { t } = useI18n()
  const [state, setState] = useState<AtState>(() => stateFromValue(value))
  const [tz, setTz] = useState<string | undefined>(value.timezone)

  // Re-derive the form when a different schedule arrives (e.g. switching
  // tasks); an emit of our own value re-parses to the same state.
  useEffect(() => {
    setState(stateFromValue(value))
    setTz(value.timezone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.type, value.expr, value.interval, value.maxRuns, value.timezone])

  const update = (patch: Partial<AtState>, nextTz = tz): void => {
    const next = { ...state, ...patch }
    setState(next)
    onChange(emit(value, next, nextTz))
  }

  const changeTz = (nextTz: string | undefined): void => {
    setTz(nextTz)
    // Re-convert the wall time into the new timezone's ISO
    onChange(emit(value, state, nextTz))
  }

  return (
    <div className="space-y-2">
      {/* Start datetime */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>{t('schedule.startLabel')}</span>
        <input
          type="datetime-local"
          value={state.wall}
          onChange={(e) => update({ wall: e.target.value })}
          className={`${inputCls} font-mono`}
        />
      </div>

      {/* Repeat cadence */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>{t('schedule.repeatLabel')}</span>
        <select
          value={state.repeat ? 'every' : 'none'}
          onChange={(e) => update({ repeat: e.target.value === 'every' })}
          className={inputCls}
        >
          <option value="none">{t('schedule.repeatNone')}</option>
          <option value="every">{t('schedule.repeatEvery')}</option>
        </select>
        {state.repeat && (
          <>
            <span className={labelCls}>{t('schedule.everyLabel')}</span>
            <input
              type="number"
              min={1}
              value={state.n}
              onChange={(e) => update({ n: e.target.value })}
              className={`${inputCls} w-20`}
            />
            <select
              value={state.unit}
              onChange={(e) => update({ unit: e.target.value as 'm' | 'h' | 'd' })}
              className={inputCls}
            >
              <option value="m">{t('schedule.unitMinutes')}</option>
              <option value="h">{t('schedule.unitHours')}</option>
              <option value="d">{t('schedule.unitDays')}</option>
            </select>
          </>
        )}
      </div>

      {/* Run cap (repeat only) */}
      {state.repeat && (
        <div className="flex items-center gap-2">
          <span className={labelCls}>{t('schedule.runsLabel')}</span>
          <select
            value={state.limited ? 'count' : 'unlimited'}
            onChange={(e) => update({ limited: e.target.value === 'count' })}
            className={inputCls}
          >
            <option value="unlimited">{t('schedule.runsUnlimited')}</option>
            <option value="count">{t('schedule.runsLimited')}</option>
          </select>
          {state.limited && (
            <input
              type="number"
              min={1}
              value={state.maxRuns}
              onChange={(e) => update({ maxRuns: e.target.value })}
              className={`${inputCls} w-20`}
            />
          )}
          <span className="text-xs text-[var(--color-text-dim)]">{t('schedule.runsUnit')}</span>
        </div>
      )}

      {/* Timezone */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>{t('schedule.timezone')}</span>
        <select
          value={tz ?? ''}
          onChange={(e) => changeTz(e.target.value || undefined)}
          className={inputCls}
        >
          <option value="">{t('schedule.tzSystem')}</option>
          <option value="Asia/Shanghai">Asia/Shanghai</option>
          <option value="UTC">UTC</option>
        </select>
      </div>

      {/* Preview */}
      {value.type === 'at' && value.expr && (
        <div className="bg-[var(--color-hover)]/60 border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text)]">
          <span className="text-[var(--color-text-muted)]">{t('schedule.previewMeaning')}</span>{' '}
          {new Date(value.expr).toLocaleString()}
          {value.interval && (
            <span className="text-[var(--color-text-dim)]">
              {' '}
              · {t('schedule.repeatEvery')} {value.interval}
              {value.maxRuns !== undefined ? ` · ${t('schedule.descMaxRuns', { n: value.maxRuns })}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
