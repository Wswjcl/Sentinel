// End-to-end probe: run executeTask against a real opencode install and
// verify the structured event parsing (session id, tokens, tool calls, text).
import { executeTask } from '../packages/core/dist/index.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sentinel-r1-'))
writeFileSync(join(dir, 'task.md'), '# probe task\n')

const result = await executeTask({
  taskDir: dir,
  config: {
    name: 'r1-probe',
    description: 'probe',
    version: 1,
    schedule: { type: 'once', expr: 'now' },
    execution: {
      prompt: 'Create a file named hello.txt containing the word hi, then reply with exactly: DONE',
      model: 'zai-coding-plan/glm-4.7',
      timeout: 180,
    },
  },
  opencodeBin: 'opencode',
})

const r = result.record
const checks = [
  ['status success', r.status === 'success', `status=${r.status} error=${r.error}`],
  ['sessionId captured', typeof r.sessionId === 'string' && r.sessionId.startsWith('ses_'), `sessionId=${r.sessionId}`],
  ['tokens captured', (r.tokens?.total ?? 0) > 0, `tokens=${JSON.stringify(r.tokens)}`],
  ['steps captured', (r.steps ?? 0) >= 1, `steps=${r.steps}`],
  ['toolCalls captured', (r.toolCalls?.length ?? 0) >= 1 && r.toolCalls[0].tool === 'write', JSON.stringify(r.toolCalls?.map(c => c.tool))],
  ['clean output text', typeof r.output === 'string' && !r.output.includes('{"type"') && (r.output.includes('DONE') || r.output.includes('tool calls')), `output=${JSON.stringify(r.output?.slice(0, 200))}`],
  ['summary digest', result.summary.includes('tool calls') && result.summary.includes('write'), result.summary.slice(0, 300)],
]

let failed = 0
for (const [name, ok, detail] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name} ${ok ? '' : `:: ${detail}`}`)
}
process.exit(failed > 0 ? 1 : 0)
