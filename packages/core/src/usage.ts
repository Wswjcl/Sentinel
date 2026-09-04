import type { TokenUsage } from './types.js'

/**
 * Usage aggregation: pure functions over run records. Sources are task
 * run records (tokens/cost/modelUsed/provider stamped by the executors)
 * and flow AI-node runs (tokens/cost copied onto FlowNodeRun). No local
 * pricing table needed - opencode reports cost per run already; if a
 * record has no cost (free models, older records) it contributes 0.
 */

export interface UsageRecordish {
  /** Task name or flow name the usage belongs to */
  source: string
  sourceType: 'task' | 'flow'
  startedAt: string
  tokens?: TokenUsage
  cost?: number
  modelUsed?: string
  provider?: string
}

export interface UsageDayBucket {
  date: string
  runs: number
  input: number
  output: number
  total: number
  cost: number
}

export interface UsageModelBucket {
  model: string
  runs: number
  total: number
  cost: number
}

export interface UsageSourceBucket {
  source: string
  sourceType: 'task' | 'flow'
  runs: number
  total: number
  cost: number
}

export interface UsageSummary {
  runs: number
  tokens: { input: number; output: number; total: number }
  cost: number
  /** Ascending by date, local calendar days */
  days: UsageDayBucket[]
  /** Descending by total tokens */
  models: UsageModelBucket[]
  /** Descending by total tokens */
  sources: UsageSourceBucket[]
  /** ISO instant the range starts (now - days) */
  since: string
  /** Range length in days that was requested */
  rangeDays: number
}

/** Local calendar day key (YYYY-MM-DD) - usage attribution follows the
 *  user's wall clock, not UTC, since that is how they think about "today". */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Current local month prefix (YYYY-MM) for month-to-date budget math. */
export function localMonthKey(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}`
}

export function aggregateUsage(records: UsageRecordish[], days = 30): UsageSummary {
  const since = new Date(Date.now() - days * 86_400_000)
  const summary: UsageSummary = {
    runs: 0,
    tokens: { input: 0, output: 0, total: 0 },
    cost: 0,
    days: [],
    models: [],
    sources: [],
    since: since.toISOString(),
    rangeDays: days,
  }
  const byDay = new Map<string, UsageDayBucket>()
  const byModel = new Map<string, UsageModelBucket>()
  const bySource = new Map<string, UsageSourceBucket>()

  for (const rec of records) {
    if (!rec.startedAt || new Date(rec.startedAt) < since) continue
    const t = rec.tokens ?? { input: 0, output: 0, total: 0 }
    const cost = rec.cost ?? 0
    summary.runs++
    summary.tokens.input += t.input ?? 0
    summary.tokens.output += t.output ?? 0
    summary.tokens.total += t.total ?? 0
    summary.cost += cost

    const dayKey = localDayKey(rec.startedAt)
    if (dayKey) {
      const day = byDay.get(dayKey) ?? { date: dayKey, runs: 0, input: 0, output: 0, total: 0, cost: 0 }
      day.runs++
      day.input += t.input ?? 0
      day.output += t.output ?? 0
      day.total += t.total ?? 0
      day.cost += cost
      byDay.set(dayKey, day)
    }

    const model = rec.modelUsed?.trim() || 'unknown'
    const mb = byModel.get(model) ?? { model, runs: 0, total: 0, cost: 0 }
    mb.runs++
    mb.total += t.total ?? 0
    mb.cost += cost
    byModel.set(model, mb)

    const sb = bySource.get(rec.source) ?? {
      source: rec.source, sourceType: rec.sourceType, runs: 0, total: 0, cost: 0,
    }
    sb.runs++
    sb.total += t.total ?? 0
    sb.cost += cost
    bySource.set(rec.source, sb)
  }

  summary.days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  summary.models = [...byModel.values()].sort((a, b) => b.total - a.total)
  summary.sources = [...bySource.values()].sort((a, b) => b.total - a.total)
  return summary
}

/** Month-to-date usage for budget gating: sums cost/tokens of records in
 *  the current local calendar month. */
export function monthToDate(records: UsageRecordish[], now = new Date()): { cost: number; tokens: number } {
  const prefix = localMonthKey(now)
  let cost = 0
  let tokens = 0
  for (const rec of records) {
    // startedAt is a UTC ISO string, so the month can only be read through
    // localDayKey (local wall clock) - a raw startsWith(prefix) would push
    // the first hours of a local month into the previous one for any
    // non-UTC timezone.
    const day = localDayKey(rec.startedAt)
    if (!day || day.slice(0, 7) !== prefix) continue
    cost += rec.cost ?? 0
    tokens += rec.tokens?.total ?? 0
  }
  return { cost, tokens }
}
