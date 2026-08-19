// End-to-end probe for R2 session continuity: run 1 tells the agent a
// secret word; run 2 continues/forks the session and must recall it.
import { executeTask } from '../packages/core/dist/index.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sentinel-r2-'))
const baseExec = {
  model: 'zai-coding-plan/glm-4.7',
  timeout: 180,
}
const mkConfig = (prompt, session) => ({
  name: 'r2-probe',
  description: 'probe',
  version: 1,
  schedule: { type: 'once', expr: 'now' },
  execution: { prompt, ...baseExec, session },
})

// Run 1: fresh session, tell the secret
const r1 = await executeTask({ taskDir: dir, config: mkConfig(
  'Remember this secret word for later: XYZZY-Q7. Reply with exactly: OK', 'fresh') })
console.log('run1 status:', r1.record.status, 'session:', r1.record.sessionId)
if (r1.record.status !== 'success' || !r1.record.sessionId) {
  console.log('FAIL - run1 did not succeed'); process.exit(1)
}

// Run 2: fork the session, ask for the secret back
const r2 = await executeTask({ taskDir: dir, config: mkConfig(
  'What secret word did I tell you earlier? Reply with just the word.', 'fork'),
  continueSession: { sessionId: r1.record.sessionId, fork: true } })
console.log('run2 status:', r2.record.status, 'session:', r2.record.sessionId)

const checks = [
  ['run2 success', r2.record.status === 'success', r2.record.error],
  ['fork created a new session id', r2.record.sessionId && r2.record.sessionId !== r1.record.sessionId,
    `${r1.record.sessionId} vs ${r2.record.sessionId}`],
  ['context carried over (secret recalled)', (r2.record.output ?? '').includes('XYZZY-Q7'),
    `output=${JSON.stringify(r2.record.output)}`],
]
let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : ` :: ${detail}`}`)
}
process.exit(failed > 0 ? 1 : 0)
