import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { UsageSummary, UsageDayBucket } from '@sentinel/core'
import type { BudgetStatus } from '../../../../shared/ipc-types'

const RANGES = [7, 30, 90] as const

const num = (n: number): string => n.toLocaleString()
const usd = (n: number): string => `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`

const DAY_MS = 86_400_000

/** GitHub-contribution-style color ramp - CSS vars keep it theme-aware. */
const HEAT_LEVELS = [
  'var(--color-hover)',
  'color-mix(in srgb, var(--color-blue) 25%, transparent)',
  'color-mix(in srgb, var(--color-blue) 50%, transparent)',
  'color-mix(in srgb, var(--color-blue) 75%, transparent)',
  'var(--color-blue)',
]

/** Weekday label rows; the grid runs Sunday (top) .. Saturday (bottom). */
const WEEKDAY_ROWS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const

const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface HeatCell {
  key: string
  bg: string
  tip: string
}

interface HeatColumn {
  key: string
  monthLabel: string
  cells: Array<HeatCell | null>
}

/** Lay the range out as week columns (Sunday first, GitHub style). Days
 *  outside the selected window become invisible spacers so columns stay
 *  aligned; days without usage render as empty squares. */
function buildHeatmap(buckets: UsageDayBucket[], rangeDays: number, locale: string): HeatColumn[] {
  const byDate = new Map(buckets.map((d) => [d.date, d]))
  const max = Math.max(1, ...buckets.map((d) => d.total))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (rangeDays - 1))
  const gridStart = new Date(start)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const columns: HeatColumn[] = []
  let lastMonth = -1
  const cursor = new Date(gridStart)
  for (let w = 0; ; w++) {
    const cells: Array<HeatCell | null> = []
    let visible = 0
    let firstVisible: Date | null = null
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(cursor)
      cursor.setDate(cursor.getDate() + 1)
      if (d < start || d > today) {
        cells.push(null)
        continue
      }
      visible++
      if (!firstVisible) firstVisible = d
      const key = dateKey(d)
      const b = byDate.get(key)
      const total = b?.total ?? 0
      const level = total <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((total / max) * 4)))
      cells.push({
        key,
        bg: HEAT_LEVELS[level],
        tip: `${key} · ${num(total)} tok · ${usd(b?.cost ?? 0)}`,
      })
    }
    if (visible === 0) break
    // `locale` arrives as a BCP-47 tag ('zh-CN' / 'en-US') - use it as-is
    const label =
      firstVisible && firstVisible.getMonth() !== lastMonth
        ? firstVisible.toLocaleDateString(locale, { month: 'short' })
        : ''
    if (label && firstVisible) lastMonth = firstVisible.getMonth()
    columns.push({ key: `w${w}`, monthLabel: label, cells })
  }
  return columns
}

/** Usage dashboard: tokens & cost aggregated from local run records
 *  (task histories + flow AI-node runs), plus per-task budget progress. */
export default function UsagePanel() {
  const { t, locale } = useI18n()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [heatDays, setHeatDays] = useState<UsageDayBucket[]>([])
  const [budgets, setBudgets] = useState<BudgetStatus[]>([])
  const [loading, setLoading] = useState(false)

  const load = (d: number): void => {
    setLoading(true)
    window.api
      .getUsage(d)
      .then((r) => {
        setSummary(r.summary)
        setHeatDays(r.heatDays)
        setBudgets(r.budgets)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(days)
  }, [days])

  // GitHub-style: the heatmap is always a fixed one-year window ending
  // today, independent of the 7/30/90 summary selector.
  const heatmap = buildHeatmap(heatDays, 365, locale === 'zh' ? 'zh-CN' : 'en-US')
  const cappedBudgets = budgets.filter((b) => b.budget)

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">{t('usage.title')}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('usage.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                days === r
                  ? 'bg-[var(--color-blue)] text-white'
                  : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {t('usage.days', { n: r })}
            </button>
          ))}
          <button
            onClick={() => load(days)}
            className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-text-muted)]
                       hover:text-[var(--color-text)] transition-colors"
            title={t('usage.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="text-xs text-[var(--color-text-muted)]">{t('usage.runs')}</div>
              <div className="text-2xl font-semibold text-[var(--color-text-bright)] mt-1">{num(summary.runs)}</div>
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="text-xs text-[var(--color-text-muted)]">{t('usage.tokens')}</div>
              <div className="text-2xl font-semibold text-[var(--color-text-bright)] mt-1">{num(summary.tokens.total)}</div>
              <div className="text-xs text-[var(--color-text-dim)] mt-1">
                {t('usage.inOut', { in: num(summary.tokens.input), out: num(summary.tokens.output) })}
              </div>
            </div>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="text-xs text-[var(--color-text-muted)]">{t('usage.cost')}</div>
              <div className="text-2xl font-semibold text-[var(--color-text-bright)] mt-1">{usd(summary.cost)}</div>
              <div className="text-xs text-[var(--color-text-dim)] mt-1">{t('usage.costHint')}</div>
            </div>
          </div>

          {/* Daily heatmap (GitHub contribution style) */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                {t('usage.trend')}
              </h2>
              <div className="flex items-center gap-1 text-[9px] text-[var(--color-text-dim)]">
                <span>{t('usage.less')}</span>
                {HEAT_LEVELS.map((bg) => (
                  <span key={bg} className="w-[10px] h-[10px] rounded-[2px]" style={{ background: bg }} />
                ))}
                <span>{t('usage.more')}</span>
              </div>
            </div>
            <div className="flex gap-1.5 py-1">
              {/* Weekday labels; offset by the 16px month-label row */}
              <div className="flex flex-col gap-[3px] mt-4 shrink-0">
                {WEEKDAY_ROWS.map((label, i) => (
                  <span key={i} className="w-7 h-[11px] text-[9px] leading-[11px] text-[var(--color-text-dim)]">
                    {label ? t(`usage.wd${label}`) : ''}
                  </span>
                ))}
              </div>
              <div className="flex gap-[3px]">
                {heatmap.map((col) => (
                  <div key={col.key} className="flex flex-col gap-[3px]">
                    <span className="h-4 text-[9px] leading-4 text-[var(--color-text-dim)] whitespace-nowrap">
                      {col.monthLabel}
                    </span>
                    {col.cells.map((cell, ci) =>
                      cell ? (
                        <div key={cell.key} className="relative group">
                          <span
                            className="block w-[11px] h-[11px] rounded-[2px] transition-transform group-hover:scale-125"
                            style={{ background: cell.bg }}
                          />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                                         whitespace-nowrap bg-[var(--color-card)] border border-[var(--color-border)]
                                         rounded px-2 py-1 text-[10px] text-[var(--color-text)] z-20">
                            {cell.tip}
                          </div>
                        </div>
                      ) : (
                        <span key={`pad-${ci}`} className="block w-[11px] h-[11px] rounded-[2px]" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* By model */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
              <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                {t('usage.byModel')}
              </h2>
              {summary.models.length === 0 ? (
                <p className="text-xs text-[var(--color-text-dim)]">{t('usage.empty')}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--color-text-dim)] text-left">
                      <th className="pb-1 font-medium">{t('usage.model')}</th>
                      <th className="pb-1 font-medium text-right">{t('usage.runsCol')}</th>
                      <th className="pb-1 font-medium text-right">Tokens</th>
                      <th className="pb-1 font-medium text-right">{t('usage.costCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.models.map((m) => (
                      <tr key={m.model} className="border-t border-[var(--color-border)]">
                        <td className="py-1.5 font-mono text-[var(--color-text)] truncate max-w-[180px]">{m.model}</td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{num(m.runs)}</td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{num(m.total)}</td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{usd(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* By source + budget progress */}
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
              <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                {t('usage.bySource')}
              </h2>
              {summary.sources.length === 0 ? (
                <p className="text-xs text-[var(--color-text-dim)]">{t('usage.empty')}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--color-text-dim)] text-left">
                      <th className="pb-1 font-medium">{t('usage.source')}</th>
                      <th className="pb-1 font-medium text-right">{t('usage.runsCol')}</th>
                      <th className="pb-1 font-medium text-right">Tokens</th>
                      <th className="pb-1 font-medium text-right">{t('usage.costCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sources.map((src) => (
                      <tr key={src.source} className="border-t border-[var(--color-border)]">
                        <td className="py-1.5 text-[var(--color-text)] truncate max-w-[160px]">
                          <span className="text-[var(--color-text-dim)]">{src.sourceType === 'flow' ? '⇉ ' : '□ '}</span>
                          {src.source}
                        </td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{num(src.runs)}</td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{num(src.total)}</td>
                        <td className="py-1.5 text-right text-[var(--color-text-muted)]">{usd(src.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Budget progress */}
              {cappedBudgets.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
                  <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">{t('usage.budgets')}</h3>
                  <div className="space-y-2">
                    {cappedBudgets.map((b) => {
                      const costPct = b.budget?.monthlyCostUsd ? (b.monthCost / b.budget.monthlyCostUsd) * 100 : null
                      const tokPct = b.budget?.monthlyTokens ? (b.monthTokens / b.budget.monthlyTokens) * 100 : null
                      const pct = Math.max(costPct ?? 0, tokPct ?? 0)
                      return (
                        <div key={`${b.sourceType}:${b.source}`}>
                          <div className="flex justify-between text-[11px] mb-0.5">
                            <span className={b.exceeded ? 'text-[var(--color-red)] font-medium' : 'text-[var(--color-text-muted)]'}>
                              {b.source}
                              {b.exceeded && ` · ${t('usage.exceeded')}`}
                            </span>
                            <span className="text-[var(--color-text-dim)] font-mono">
                              {usd(b.monthCost)}
                              {b.budget?.monthlyCostUsd !== undefined ? ` / $${b.budget.monthlyCostUsd}` : ''}
                              {b.budget?.monthlyTokens !== undefined ? ` · ${num(b.monthTokens)}/${num(b.budget.monthlyTokens)}` : ''} tok
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--color-hover)] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                pct >= 100 ? 'bg-[var(--color-red)]' : pct >= 80 ? 'bg-[var(--color-yellow)]' : 'bg-[var(--color-green)]'
                              }`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
