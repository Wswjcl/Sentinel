#!/usr/bin/env node
/**
 * Usage aggregation smoke tests: day/model/source bucketing, range
 * filtering, month-to-date math used by the budget gate.
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const coreDist = process.argv[2] ?? new URL('../packages/core/dist/', import.meta.url).pathname
const { aggregateUsage, monthToDate, localDayKey, localMonthKey } = await import(
  pathToFileURL(join(coreDist, 'usage.js')).href
)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`OK   | ${name}`) }
  else { fail++; console.log(`FAIL | ${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── localDayKey / localMonthKey ──
check('day key uses local calendar', /^\d{4}-\d{2}-\d{2}$/.test(localDayKey(new Date().toISOString())))
check('invalid date → empty key', localDayKey('not-a-date') === '')
check('month key format', /^\d{4}-\d{2}$/.test(localMonthKey()))

// ── aggregateUsage ──
const today = localDayKey(new Date().toISOString())
const yesterday = localDayKey(new Date(Date.now() - 86_400_000).toISOString())
const old = localDayKey(new Date(Date.now() - 90 * 86_400_000).toISOString())

const recs = [
  { source: 'alpha', sourceType: 'task', startedAt: new Date().toISOString(), tokens: { input: 100, output: 50, total: 150 }, cost: 0.02, modelUsed: 'opencode/mimo-v2.5-free', provider: 'opencode' },
  { source: 'alpha', sourceType: 'task', startedAt: new Date().toISOString(), tokens: { input: 200, output: 100, total: 300 }, cost: 0.04, modelUsed: 'opencode/mimo-v2.5-free', provider: 'opencode' },
  { source: 'beta-flow', sourceType: 'flow', startedAt: new Date(Date.now() - 86_400_000).toISOString(), tokens: { input: 10, output: 5, total: 15 }, cost: 0, modelUsed: 'opencode/qwen3-coder-free' },
  // No tokens (older records / failed runs) - still counts as a run
  { source: 'alpha', sourceType: 'task', startedAt: new Date().toISOString() },
  // Outside a 30-day range - excluded
  { source: 'alpha', sourceType: 'task', startedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(), tokens: { input: 999, output: 999, total: 1998 }, cost: 9.99, modelUsed: 'x/y' },
]

const s30 = aggregateUsage(recs, 30)
check('runs counted incl. token-less records', s30.runs === 4, String(s30.runs))
check('range excludes old records', s30.tokens.total === 465 && Math.abs(s30.cost - 0.06) < 1e-9, JSON.stringify(s30.tokens))
check('days bucketed by local date', eq(s30.days.map((d) => d.date), [yesterday, today].sort()), JSON.stringify(s30.days.map((d) => d.date)))
const todayBucket = s30.days.find((d) => d.date === today)
check('today bucket sums', todayBucket && todayBucket.runs === 3 && todayBucket.total === 450, JSON.stringify(todayBucket))
check('models sorted by tokens desc', s30.models[0].model === 'opencode/mimo-v2.5-free' && s30.models[0].total === 450, JSON.stringify(s30.models))
check('sources sorted by tokens desc', s30.sources[0].source === 'alpha' && s30.sources[0].sourceType === 'task', JSON.stringify(s30.sources))
check('flow source labeled', s30.sources[1].source === 'beta-flow' && s30.sources[1].sourceType === 'flow')
check('free model cost is zero', s30.models.find((m) => m.model === 'opencode/qwen3-coder-free')?.cost === 0)
check('range metadata set', s30.rangeDays === 30 && typeof s30.since === 'string')

const s7 = aggregateUsage(recs, 7)
check('shorter range still includes yesterday', s7.runs === 4)
const s1 = aggregateUsage(recs, 1)
// 1-day range may still include yesterday's record depending on the hour
// of day; it must exclude the 90-day-old record either way.
check('1-day range excludes old records', s1.tokens.total < 2000, String(s1.tokens.total))

// ── monthToDate (budget gate math) ──
const monthRecs = [
  { source: 't', sourceType: 'task', startedAt: new Date().toISOString(), tokens: { input: 1, output: 1, total: 1000 }, cost: 0.5 },
  { source: 't', sourceType: 'task', startedAt: new Date().toISOString(), tokens: { input: 1, output: 1, total: 2000 }, cost: 1.5 },
  // last month's record - excluded (2026-08-31 style edge is still "this month" if today is Aug 31)
  { source: 't', sourceType: 'task', startedAt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString(), tokens: { input: 1, output: 1, total: 999999 }, cost: 99 },
]
const m = monthToDate(monthRecs)
check('month-to-date sums only current month', Math.abs(m.cost - 2) < 1e-9 && m.tokens === 3000, JSON.stringify(m))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
