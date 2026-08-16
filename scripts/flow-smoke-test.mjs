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

// ── Test 6: manual gate without aiTakeover is skipped, flow succeeds ──
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
const r6 = await engine.run('manual-flow')
check('T6 manual gate skipped', r6.nodes.gate.status === 'skipped' && r6.nodes.gate.skipReason === 'manual-gate', JSON.stringify(r6.nodes.gate))
check('T6 flow still success', r6.status === 'success', `status=${r6.status}`)

// ── Test 7: run persistence ──
const store = new FlowStore({ flowsDir })
const runs = await store.getRuns('parallel-flow')
check('T7 runs persisted', runs.length === 1 && runs[0].status === 'success', `runs=${runs.length}`)

// cleanup
await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL SMOKE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
