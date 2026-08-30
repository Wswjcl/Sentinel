// describeCron smoke test: recognized patterns, edge cases, fallback.
import { describeCron, getNextRun, isValidCron } from '../packages/core/dist/index.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

check('C1 every-minutes 1', JSON.stringify(describeCron('* * * * *')) === JSON.stringify({ kind: 'every-minutes', minutes: 1 }))
check('C2 every 15 minutes', describeCron('*/15 * * * *').kind === 'every-minutes' && describeCron('*/15 * * * *').minutes === 15)
check('C3 hourly at minute 0', JSON.stringify(describeCron('0 * * * *')) === JSON.stringify({ kind: 'every-hours', hours: 1 }))
check('C4 every 2 hours at :30', describeCron('30 */2 * * *').kind === 'every-hours' && describeCron('30 */2 * * *').hours === 2)
check('C5 daily 09:00', JSON.stringify(describeCron('0 9 * * *')) === JSON.stringify({ kind: 'daily', time: '09:00' }))
check('C6 daily zero-padded', describeCron('30 7 * * *').time === '07:30')
check('C7 weekdays 09:00', describeCron('0 9 * * 1-5').kind === 'weekdays')
check('C8 weekly on monday', describeCron('0 9 * * 1').kind === 'weekly' && describeCron('0 9 * * 1').weekday === 1)
check('C9 custom fallback', describeCron('0 9 1,15 * *').kind === 'custom')
check('C10 custom ranges', describeCron('5-10 9 * * *').kind === 'custom')
check('C11 malformed fields', describeCron('0 9 * *').kind === 'custom')

// sanity: the generated patterns are valid and schedulable
for (const expr of ['*/15 * * * *', '0 * * * *', '0 9 * * *', '0 9 * * 1-5', '0 9 * * 1']) {
  check(`C12 ${expr} valid+next`, isValidCron(expr) && getNextRun(expr) instanceof Date)
}

console.log(failures === 0 ? '\n=== ALL DESCRIBE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
