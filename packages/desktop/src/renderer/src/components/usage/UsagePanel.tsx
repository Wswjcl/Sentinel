import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { UsageSummary } from '@sentinel/core'
import type { BudgetStatus } from '../../../../shared/ipc-types'

const RANGES = [7, 30, 90] as const

const num = (n: number): string => n.toLocaleString()
const usd = (n: number): string => `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`

/** Usage dashboard: tokens & cost aggregated from local run records
 *  (task histories + flow AI-node runs), plus per-task budget progress. */
export default function UsagePanel() {
  const { t } = useI18n()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [budgets, setBudgets] = useState<BudgetStatus[]>([])
  const [loading, setLoading] = useState(false)

  const load = (d: number): void => {
    setLoading(true)
    window.api
      .getUsage(d)
      .then((r) => {
        setSummary(r.summary)
        setBudgets(r.budgets)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(days)
  }, [days])

  const maxDay = Math.max(1, ...(summary?.days ?? []).map((d) => d.total))
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

          {/* Daily trend */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
            <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              {t('usage.trend')}
            </h2>
            {summary.days.length === 0 ? (
              <p className="text-xs text-[var(--color-text-dim)] py-4">{t('usage.empty')}</p>
            ) : (
              <div className="flex items-end gap-1 h-28">
                {summary.days.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative min-w-0">
                    <div
                      className="w-full rounded-t bg-[var(--color-blue)]/70 hover:bg-[var(--color-blue)] transition-colors"
                      style={{ height: `${Math.max(3, (d.total / maxDay) * 88)}px` }}
                    />
                    <span className="text-[9px] text-[var(--color-text-dim)] truncate w-full text-center">
                      {d.date.slice(5)}
                    </span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                                   whitespace-nowrap bg-[var(--color-card)] border border-[var(--color-border)]
                                   rounded px-2 py-1 text-[10px] text-[var(--color-text)] z-10">
                      {d.date} · {num(d.total)} tok · {usd(d.cost)}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
