// 'at' schedule smoke test: shouldRunAt gating (start time, cadence,
// run cap), isScheduleExhausted archive triggers, nextAtRun projection.
import { shouldRunAt, isScheduleExhausted, nextAtRun, isValidSchedule } from '../packages/core/dist/index.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()

// validity
check('A1 valid iso', isValidSchedule('at', iso(NOW)))
check('A2 invalid date rejected', !isValidSchedule('at', 'not-a-date'))

// gating: before start -> false, after start -> true
check('A3 before start no run', !shouldRunAt(iso(NOW + 3600_000), undefined, null, 0, undefined))
check('A4 past start runs once', shouldRunAt(iso(NOW - 1000), undefined, null, 0, undefined))
check('A5 no-interval second run blocked', !shouldRunAt(iso(NOW - 1000), undefined, new Date(NOW - 500), 1, undefined))

// cadence
check('A6 interval waits after last run', !shouldRunAt(iso(NOW - 3600_000), '30m', new Date(NOW - 60_000), 1, undefined))
check('A7 interval due after cadence', shouldRunAt(iso(NOW - 3600_000), '30m', new Date(NOW - 31 * 60_000), 1, undefined))
check('A8 first run of interval schedule', shouldRunAt(iso(NOW - 1000), '30m', null, 0, undefined))

// run cap
check('A9 maxRuns blocks at cap', !shouldRunAt(iso(NOW - 3600_000), '1m', new Date(NOW - 120_000), 12, 12))
check('A10 maxRuns allows below cap', shouldRunAt(iso(NOW - 3600_000), '1m', new Date(NOW - 120_000), 11, 12))
check('A11 maxRuns blocks even before cadence', !shouldRunAt(iso(NOW - 3600_000), '1m', new Date(NOW - 1000), 12, 12))

// exhausted -> auto-archive trigger
check('A12 once always exhausted', isScheduleExhausted({ type: 'once' }, 0))
check('A13 at no-interval exhausted after 1 run', isScheduleExhausted({ type: 'at', expr: 'x' }, 1) && !isScheduleExhausted({ type: 'at', expr: 'x' }, 0))
check('A14 at maxRuns exhausted at cap', isScheduleExhausted({ type: 'at', expr: 'x', maxRuns: 3 }, 3) && !isScheduleExhausted({ type: 'at', expr: 'x', maxRuns: 3 }, 2))
check('A15 at unlimited interval never exhausted', !isScheduleExhausted({ type: 'at', expr: 'x', interval: '5m' }, 9999))
check('A16 cron never exhausted', !isScheduleExhausted({ type: 'cron', expr: '* * * * *' }, 9999))

// nextAtRun projection
check('A17 future start is next run', nextAtRun(iso(NOW + 3600_000), undefined, null)?.getTime() === NOW + 3600_000)
check('A18 past start no interval -> null (finished)', nextAtRun(iso(NOW - 3600_000), undefined, null) === null)
check('A19 interval projects from last run', nextAtRun(iso(NOW - 3600_000), '30m', new Date(NOW - 10 * 60_000))?.getTime() === NOW + 20 * 60_000)

console.log(failures === 0 ? '\n=== ALL AT-SCHEDULE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
