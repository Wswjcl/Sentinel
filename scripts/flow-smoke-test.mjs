// Flow engine smoke test - runs against the built core dist,
// using only script nodes so no OpenCode installation is needed.
import { FlowStore, FlowEngine, validateFlow, TaskStore } from '../packages/core/dist/index.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const tmp = join(process.env.TEMP || '/tmp', `sentinel-flow-test-${randomUUID().slice(0, 8)}`)
const flowsDir = join(tmp, 'flows')
const tasksDir = join(tmp, 'tasks')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

async function writeFlow(name, yaml) {
  await fs.mkdir(join(flowsDir, name), { recursive: true })
  await fs.writeFile(join(flowsDir, name, 'flow.yaml'), yaml, 'utf-8')
}

const engine = new FlowEngine({
  flowStore: new FlowStore({ flowsDir }),
  taskStore: new TaskStore({ tasksDir }),
  concurrency: 3,
  onLog: () => {},
})
const store = new FlowStore({ flowsDir })
/** Poll the persisted latest run until predicate holds (manual gates
 *  suspend the engine promise, so tests observe via the store). */
const waitFor = async (flowName, predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runs = await store.getRuns(flowName)
    if (runs.length > 0 && predicate(runs[runs.length - 1])) return runs[runs.length - 1]
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('waitFor timeout')
}

// ── Test 1: parallel nodes + output injection ──
await writeFlow('parallel-flow', `
name: parallel-flow
version: 1
nodes:
  a:
    type: script
    run: "echo hello-A"
  b:
    type: script
    run: "echo hello-B"
  c:
    type: script
    run: "echo got:{a.output}and:{b.output}"
    needs: [a, b]
`)
const r1 = await engine.run('parallel-flow')
check('T1 flow success', r1.status === 'success', `status=${r1.status}`)
check('T1 node a success', r1.nodes.a.status === 'success')
check('T1 node b success', r1.nodes.b.status === 'success')
check('T1 output injected', (r1.nodes.c.output ?? '').includes('hello-A') && (r1.nodes.c.output ?? '').includes('hello-B'), `c.output=${JSON.stringify(r1.nodes.c.output)}`)
// parallelism: a and b should both have started before either finished
const aStart = Date.parse(r1.nodes.a.startedAt), bStart = Date.parse(r1.nodes.b.startedAt)
const aEnd = Date.parse(r1.nodes.a.finishedAt), bEnd = Date.parse(r1.nodes.b.finishedAt)
check('T1 a/b ran in parallel', bStart < aEnd && aStart < bEnd, `a=[${aStart},${aEnd}] b=[${bStart},${bEnd}]`)

// ── Test 2: failure propagation (onFailure stop default) ──
await writeFlow('fail-flow', `
name: fail-flow
version: 1
nodes:
  x:
    type: script
    run: "exit 3"
  y:
    type: script
    run: "echo never"
    needs: [x]
  z:
    type: script
    run: "echo independent"
`)
const r2 = await engine.run('fail-flow')
check('T2 flow failed', r2.status === 'failed', `status=${r2.status}`)
check('T2 node x failed', r2.nodes.x.status === 'failed', r2.nodes.x.error)
check('T2 downstream y skipped', r2.nodes.y.status === 'skipped' && r2.nodes.y.skipReason === 'upstream-failure', JSON.stringify(r2.nodes.y))
check('T2 independent z still ran', r2.nodes.z.status === 'success')

// ── Test 3: onFailure continue ──
await writeFlow('continue-flow', `
name: continue-flow
version: 1
nodes:
  x:
    type: script
    run: "exit 1"
    onFailure: continue
  y:
    type: script
    run: "echo downstream-ran"
    needs: [x]
`)
const r3 = await engine.run('continue-flow')
check('T3 flow partial', r3.status === 'partial', `status=${r3.status}`)
check('T3 downstream y ran', r3.nodes.y.status === 'success')

// ── Test 4: inputs injection ──
await writeFlow('inputs-flow', `
name: inputs-flow
version: 1
nodes:
  a:
    type: script
    run: "echo value={inputs.mykey}"
`)
const r4 = await engine.run('inputs-flow', { inputs: { mykey: 'injected-42' } })
check('T4 inputs injected', (r4.nodes.a.output ?? '').includes('injected-42'), r4.nodes.a.output)

// ── Test 5: cycle detection ──
const cyc = validateFlow({
  name: 'cyc', version: 1,
  nodes: {
    a: { type: 'script', run: 'true', needs: ['b'] },
    b: { type: 'script', run: 'true', needs: ['a'] },
  },
})
check('T5 cycle detected', !cyc.valid && cyc.errors.some((e) => e.includes('cycle')), JSON.stringify(cyc.errors))

const unknown = validateFlow({
  name: 'unknown-dep', version: 1,
  nodes: { a: { type: 'script', run: 'true', needs: ['ghost'] } },
})
check('T5 unknown dep detected', !unknown.valid && unknown.errors.some((e) => e.includes('unknown node')), JSON.stringify(unknown.errors))

// ── Test 6: manual gate waits for a human decision (default approve) ──
await writeFlow('manual-flow', `
name: manual-flow
version: 1
nodes:
  a:
    type: script
    run: "echo done"
  gate:
    type: manual
    needs: [a]
`)
const r6Promise = engine.run('manual-flow')
const r6waiting = await waitFor('manual-flow', (r) => r.nodes.gate.status === 'waiting')
check('T6 gate enters waiting', r6waiting.nodes.gate.status === 'waiting', JSON.stringify(r6waiting.nodes.gate))
check('T6 upstream finished while gate waits', r6waiting.nodes.a.status === 'success')
engine.resolveManualNode('manual-flow', r6waiting.id, 'gate', { approved: true })
const r6 = await r6Promise
check('T6 gate approved with default output', r6.nodes.gate.status === 'success' && r6.nodes.gate.output === 'approved', JSON.stringify(r6.nodes.gate))
check('T6 flow success', r6.status === 'success', `status=${r6.status}`)

// ── Test 7: run persistence ──
const runs = await store.getRuns('parallel-flow')
check('T7 runs persisted', runs.length === 1 && runs[0].status === 'success', `runs=${runs.length}`)

// ── Test 8: conditional edges - failure branch triggers, success branch skipped ──
await writeFlow('cond-flow', `
name: cond-flow
version: 1
nodes:
  risky:
    type: script
    run: "exit 1"
  report:
    type: script
    run: "echo reported"
    needs: [{ node: risky, on: success }]
  alert:
    type: script
    run: "echo alerted"
    needs: [{ node: risky, on: failure }]
  cleanup:
    type: script
    run: "echo cleaned"
    needs: [{ node: risky, on: finished }]
`)
const r8 = await engine.run('cond-flow')
check('T8 failure branch ran', r8.nodes.alert.status === 'success', JSON.stringify(r8.nodes.alert))
check('T8 finished branch ran', r8.nodes.cleanup.status === 'success')
check('T8 success branch skipped', r8.nodes.report.status === 'skipped', JSON.stringify(r8.nodes.report))
check('T8 flow partial (failed + branches completed)', r8.status === 'partial', `status=${r8.status}`)

// ── Test 9: budget guard - maxTotalSeconds 0 blocks everything ──
await writeFlow('budget-flow', `
name: budget-flow
version: 1
maxTotalSeconds: 0
nodes:
  a:
    type: script
    run: "echo a"
`)
const r9 = await engine.run('budget-flow')
check('T9 node budget-exhausted', r9.nodes.a.status === 'skipped' && r9.nodes.a.skipReason === 'budget-exhausted', JSON.stringify(r9.nodes.a))
check('T9 flow failed on budget', r9.status === 'failed', `status=${r9.status}`)

// ── Test 10: resume reuses successful nodes ──
await writeFlow('resume-flow', `
name: resume-flow
version: 1
nodes:
  a:
    type: script
    run: "echo marker-42"
  b:
    type: script
    run: "exit 3"
`)
const r10a = await engine.run('resume-flow')
check('T10 first run: a ok, b failed', r10a.nodes.a.status === 'success' && r10a.nodes.b.status === 'failed')
// Fix node b, then resume from the failed run
const cfgPath = join(flowsDir, 'resume-flow', 'flow.yaml')
await fs.writeFile(cfgPath, (await fs.readFile(cfgPath, 'utf-8')).replace('exit 3', 'echo fixed'), 'utf-8')
const r10b = await engine.run('resume-flow', { resumeFromRunId: r10a.id })
check('T10 resumed flag set', r10b.resumedFrom === r10a.id)
check('T10 a reused (same finishedAt)', r10b.nodes.a.finishedAt === r10a.nodes.a.finishedAt, `${r10b.nodes.a.finishedAt} vs ${r10a.nodes.a.finishedAt}`)
check('T10 b re-ran and succeeded', r10b.nodes.b.status === 'success', JSON.stringify(r10b.nodes.b))
check('T10 resumed flow success', r10b.status === 'success', `status=${r10b.status}`)

// ── Test 11: cloneFlow - template instantiation ──
await writeFlow('template-flow', `
name: template-flow
version: 1
nodes:
  a:
    type: script
    run: "echo hi-{inputs.who}"
`)
await engine.run('template-flow', { inputs: { who: 'orig' } })
await store.cloneFlow('template-flow', 'template-flow-2')
const cloned = await store.getConfig('template-flow-2')
const clonedRuns = await store.getRuns('template-flow-2')
check('T11 clone renamed', cloned.name === 'template-flow-2' && Object.keys(cloned.nodes).length === 1)
check('T11 clone has no run history', clonedRuns.length === 0, `runs=${clonedRuns.length}`)
const r11 = await engine.run('template-flow-2', { inputs: { who: 'clone' } })
check('T11 cloned flow runs with its own inputs', (r11.nodes.a.output ?? '').includes('hi-clone'), r11.nodes.a.output)

// ── Test 12: executeOverride plumbing (serve runtime injection) ──
// A mock executor replaces the CLI path; verifies the override receives
// resolved prompt/node identity and that downstream injection uses the
// override's summary (not the raw CLI stdout).
// The AI node reads the referenced task workspace before executing
await fs.mkdir(join(tasksDir, 'some-task'), { recursive: true })
await fs.writeFile(join(tasksDir, 'some-task', 'task.yaml'), `
name: some-task
description: mock task for override test
version: 1
schedule:
  type: once
  expr: "now"
execution:
  prompt: "base prompt"
`, 'utf-8')
const overrideCalls = []
const overrideEngine = new FlowEngine({
  flowStore: engine.flowStore ?? new FlowStore({ flowsDir }),
  taskStore: new TaskStore({ tasksDir }),
  concurrency: 3,
  executeOverride: async (options) => {
    overrideCalls.push({ name: options.config.name, prompt: options.promptOverride ?? options.config.execution.prompt })
    return {
      record: {
        id: randomUUID(), taskName: options.config.name,
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        status: 'success', exitCode: 0, sessionId: 'ses_mock_1',
        tokens: { input: 10, output: 5, total: 15 }, cost: 0, steps: 1,
        toolCalls: [{ tool: 'bash', status: 'completed' }],
      },
      stdout: 'RAW-JSON-BLOB', stderr: '',
      summary: 'OVERRIDE-OUTPUT',
    }
  },
  onLog: () => {},
})
await writeFlow('override-flow', `
name: override-flow
version: 1
nodes:
  ai1:
    type: ai
    task: some-task
    promptTemplate: "do {inputs.x}"
  consumer:
    type: script
    run: "echo got:{ai1.output}"
    needs: [ai1]
`)
const r12 = await overrideEngine.run('override-flow', { inputs: { x: '42' } })
check('T12 override executed for ai node', overrideCalls.length === 1 && overrideCalls[0].name === 'some-task', JSON.stringify(overrideCalls))
check('T12 prompt template resolved', overrideCalls[0]?.prompt === 'do 42', overrideCalls[0]?.prompt)
check('T12 node succeeded via override', r12.nodes.ai1.status === 'success', JSON.stringify(r12.nodes.ai1))
check('T12 audit record id from override', typeof r12.nodes.ai1.taskRecordId === 'string' && r12.nodes.ai1.taskRecordId.length > 10, JSON.stringify(r12.nodes.ai1.taskRecordId))
check('T12 downstream injection uses summary', (r12.nodes.consumer.output ?? '').includes('OVERRIDE-OUTPUT') && !(r12.nodes.consumer.output ?? '').includes('RAW-JSON-BLOB'), r12.nodes.consumer.output)

// ── Test 13: manual gate blocks until a human approves ──
await writeFlow('gate-flow', `
name: gate-flow
version: 1
nodes:
  gate:
    type: manual
    gatePrompt: "Check the report before continuing"
  done:
    type: script
    run: "echo after:{gate.output}"
    needs: [gate]
`)
const r13Promise = engine.run('gate-flow')
const r13waiting = await waitFor('gate-flow', (r) => r.nodes.gate.status === 'waiting')
check('T13 gate enters waiting (not skipped)', r13waiting.nodes.gate.status === 'waiting', JSON.stringify(r13waiting.nodes.gate))
check('T13 downstream stays pending while waiting', r13waiting.nodes.done.status === 'pending')
check('T13 flow still running while waiting', r13waiting.status === 'running')
check('T13 waitingSince recorded', typeof r13waiting.nodes.gate.waitingSince === 'string')
check('T13 approve resolves live gate', engine.resolveManualNode('gate-flow', r13waiting.id, 'gate', { approved: true, note: 'looks good' }) === true)
const r13 = await r13Promise
check('T13 gate approved -> success with note as output', r13.nodes.gate.status === 'success' && r13.nodes.gate.output === 'looks good', JSON.stringify(r13.nodes.gate))
check('T13 note injected downstream', (r13.nodes.done.output ?? '').includes('after:looks good'), r13.nodes.done.output)
check('T13 flow success', r13.status === 'success', `status=${r13.status}`)
check('T13 second resolve returns false', engine.resolveManualNode('gate-flow', r13.id, 'gate', { approved: true }) === false)

// ── Test 14: rejected gate fails the node and blocks downstream ──
await writeFlow('gate-reject-flow', `
name: gate-reject-flow
version: 1
nodes:
  gate:
    type: manual
  done:
    type: script
    run: "echo no"
    needs: [gate]
`)
const r14Promise = engine.run('gate-reject-flow')
const r14waiting = await waitFor('gate-reject-flow', (r) => r.nodes.gate.status === 'waiting')
engine.resolveManualNode('gate-reject-flow', r14waiting.id, 'gate', { approved: false, note: 'not good enough' })
const r14 = await r14Promise
check('T14 gate rejected -> failed with note as error', r14.nodes.gate.status === 'failed' && (r14.nodes.gate.error ?? '').includes('not good enough'), JSON.stringify(r14.nodes.gate))
check('T14 downstream skipped (upstream-failure)', r14.nodes.done.status === 'skipped' && r14.nodes.done.skipReason === 'upstream-failure', JSON.stringify(r14.nodes.done))
check('T14 flow failed', r14.status === 'failed', `status=${r14.status}`)

// ── Test 15: budget guard cancels a waiting gate ──
await writeFlow('gate-budget-flow', `
name: gate-budget-flow
version: 1
maxTotalSeconds: 1
nodes:
  slow:
    type: script
    run: "node -e \\"setTimeout(()=>{}, 1500)\\""
  gate:
    type: manual
`)
const r15Promise = engine.run('gate-budget-flow')
const r15 = await r15Promise
check('T15 budget cancels waiting gate', r15.nodes.gate.status === 'skipped' && r15.nodes.gate.skipReason === 'budget-exhausted', JSON.stringify(r15.nodes.gate))
check('T15 flow failed on budget', r15.status === 'failed', `status=${r15.status}`)
check('T15 cancelled gate no longer resolvable', engine.resolveManualNode('gate-budget-flow', r15.id, 'gate', { approved: true }) === false)

// ── Test 16: lenient draft validation (editor autosave) ──
const draftCfg = {
  name: 'draft-flow', version: 1,
  nodes: { a: { type: 'ai' }, b: { type: 'script' } },
}
const draft = validateFlow(draftCfg, { lenient: true })
check('T16 lenient allows missing task/run', draft.valid, JSON.stringify(draft.errors))
const draftStructural = validateFlow({ ...draftCfg, nodes: { ...draftCfg.nodes, a: { type: 'ai', needs: ['ghost'] } } }, { lenient: true })
check('T16 lenient still rejects structural errors', !draftStructural.valid && draftStructural.errors.some((e) => e.includes('unknown node')), JSON.stringify(draftStructural.errors))
const strict = validateFlow(draftCfg)
check('T16 strict still rejects missing task', !strict.valid && strict.errors.some((e) => e.includes('requires a task reference')), JSON.stringify(strict.errors))
await writeFlow('draft-flow', `
name: draft-flow
version: 1
nodes:
  a:
    type: ai
`)
let draftRunErr = null
try {
  await engine.run('draft-flow')
} catch (err) {
  draftRunErr = String(err)
}
check('T16 engine refuses to run a draft', draftRunErr !== null && draftRunErr.includes('requires a task reference'), draftRunErr)

// cleanup
await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL SMOKE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
