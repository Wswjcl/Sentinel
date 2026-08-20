// End-to-end probe for R3 serve runtime: start a shared opencode serve
// process, execute a task with a permission gate, verify live events,
// permission approval, and structured results.
import { OpenCodeServer } from '../packages/core/dist/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sentinel-r3-'))
mkdirSync(join(dir, '.opencode'), { recursive: true })
writeFileSync(
  join(dir, '.opencode', 'opencode.json'),
  JSON.stringify({ permission: { bash: 'ask', edit: 'allow', read: 'allow' } }),
)

const server = await OpenCodeServer.start({ opencodeBin: 'opencode' })
console.log('server started at', server.address)

const nonce = Math.random().toString(36).slice(2, 10)
const config = {
  name: 'r3-probe',
  description: 'probe',
  version: 1,
  schedule: { type: 'once', expr: 'now' },
  execution: {
    prompt: `Run this shell command: echo live-serve-${nonce}. Reply with exactly the command output. You MUST actually run the command - the output cannot be guessed.`,
    model: 'zai-coding-plan/glm-4.7',
    timeout: 180,
  },
}

// Collect live events
const liveEvents = []
let permissionSeen = null

const result = await server.runTask({
  taskDir: dir,
  config,
  onEvent: (ev) => liveEvents.push(ev),
  onPermission: async (req) => {
    permissionSeen = req
    console.log('permission asked:', req.permission, JSON.stringify(req.patterns))
    return 'once'
  },
})

const r = result.record
const checks = [
  ['status success', r.status === 'success', `status=${r.status} error=${r.error}`],
  ['sessionId captured', typeof r.sessionId === 'string' && r.sessionId.startsWith('ses_'), `sessionId=${r.sessionId}`],
  ['tokens captured', (r.tokens?.total ?? 0) > 0, `tokens=${JSON.stringify(r.tokens)}`],
  ['toolCalls captured', r.toolCalls?.some((c) => c.tool === 'bash' && c.status === 'completed'), JSON.stringify(r.toolCalls?.map((c) => `${c.tool}:${c.status}`))],
  ['clean output text', typeof r.output === 'string' && !r.output.includes('{"'), `output=${JSON.stringify(r.output?.slice(0, 150))}`],
  ['permission flowed through handler', permissionSeen?.permission === 'bash' && permissionSeen.patterns[0]?.includes('echo'), JSON.stringify(permissionSeen)],
  ['live events streamed', liveEvents.some((e) => e.kind === 'text') && liveEvents.some((e) => e.kind === 'tool-start' || e.kind === 'tool-finish'), JSON.stringify(liveEvents.map((e) => e.kind))],
  ['bash tool executed (allowed via approval)', r.toolCalls?.find((c) => c.tool === 'bash')?.output?.includes(`live-serve-${nonce}`), JSON.stringify(r.toolCalls?.find((c) => c.tool === 'bash')?.output)],
]

let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : ` :: ${detail}`}`)
}

// ── Abort test: start a long run and abort it ──
const abortController = new AbortController()
const abortPromise = server.runTask({
  taskDir: dir,
  config: { ...config, execution: { ...config.execution, prompt: 'Count from 1 to 100000 slowly, one number per line.' } },
  abortSignal: abortController.signal,
})
await new Promise((resolve) => setTimeout(resolve, 5000))
abortController.abort()
const aborted = await abortPromise
const abortOk = aborted.record.status === 'failed' && /abort/i.test(aborted.record.error ?? '')
if (!abortOk) failed++
console.log(`${abortOk ? 'PASS' : 'FAIL'} - abort works :: status=${aborted.record.status} error=${aborted.record.error}`)

await server.stop()
console.log(failed === 0 ? '=== ALL R3 PROBES PASSED ===' : `=== ${failed} R3 PROBES FAILED ===`)
process.exit(failed > 0 ? 1 : 0)
