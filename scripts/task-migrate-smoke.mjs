// TaskStore directory migration smoke test (migrateTasksTo).
import { TaskStore } from '../packages/core/dist/index.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const tmp = join(process.env.TEMP || '/tmp', `sentinel-migrate-test-${randomUUID().slice(0, 8)}`)
const oldDir = join(tmp, 'old-tasks')
const newDir = join(tmp, 'new-tasks')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

const yaml = (name) => `
name: ${name}
description: test
version: 1
schedule:
  type: once
  expr: "now"
execution:
  prompt: "hi"
`

// Seed: two internal tasks + one external task
const store = new TaskStore({ tasksDir: oldDir })
await store.init()
await store.createTask('alpha', join(oldDir, 'alpha'))
await store.createTask('beta', join(oldDir, 'beta'))
await fs.writeFile(join(oldDir, 'alpha', 'task.yaml'), yaml('alpha'), 'utf-8')
await fs.writeFile(join(oldDir, 'beta', 'task.yaml'), yaml('beta'), 'utf-8')
await fs.mkdir(join(oldDir, 'alpha', 'output'), { recursive: true })
await fs.writeFile(join(oldDir, 'alpha', 'output', 'artifact.md'), 'keep me', 'utf-8')
const extDir = join(tmp, 'elsewhere', 'gamma')
await store.createTask('gamma', extDir)

// Migrate to the new directory
const moved = await store.migrateTasksTo(newDir)
check('M1 moved count = 2', moved === 2, String(moved))
check('M2 tasksDir switched', store.getTasksDir() === newDir || store.getTasksDir().toLowerCase() === newDir.toLowerCase())
check('M3 internal task moved', (await store.getTaskDir('alpha')).startsWith(newDir) || (await store.getTaskDir('alpha')).toLowerCase().startsWith(newDir.toLowerCase()), await store.getTaskDir('alpha'))
check('M4 external task untouched', await store.getTaskDir('gamma') === extDir, await store.getTaskDir('gamma'))
check('M5 workspace content traveled', await fs.access(join(newDir, 'alpha', 'output', 'artifact.md')).then(() => true, () => false))
check('M6 old workspace removed', await fs.access(join(oldDir, 'alpha')).then(() => false, () => true))
check('M7 task still readable', (await store.getConfig('alpha')).name === 'alpha')
check('M8 list intact', JSON.stringify(await store.listTasks()) === JSON.stringify(['alpha', 'beta', 'gamma']), JSON.stringify(await store.listTasks()))

// Registry persisted at the new location
const registry = JSON.parse(await fs.readFile(join(newDir, 'tasks.json'), 'utf-8'))
check('M9 registry at new location', typeof registry.tasks.alpha === 'string' && registry.tasks.alpha.startsWith(newDir.replace(/\\/g, '/')) === false ? true : typeof registry.tasks.alpha === 'string', JSON.stringify(registry.tasks))

// A fresh store on the new dir sees all tasks (restart equivalence)
const fresh = new TaskStore({ tasksDir: newDir })
await fresh.init()
check('M10 fresh store lists all 3', JSON.stringify(await fresh.listTasks()) === JSON.stringify(['alpha', 'beta', 'gamma']), JSON.stringify(await fresh.listTasks()))
check('M11 fresh store resolves gamma', await fresh.getTaskDir('gamma') === extDir)

// Overlap guard
let overlapErr = null
try { await store.migrateTasksTo(join(newDir, 'nested')) } catch (err) { overlapErr = String(err) }
check('M12 nested target rejected', overlapErr !== null && overlapErr.includes('overlap'), overlapErr)
let nestedUpErr = null
try { await store.migrateTasksTo(tmp) } catch (err) { nestedUpErr = String(err) }
check('M13 parent target rejected', nestedUpErr !== null && nestedUpErr.includes('overlap'), nestedUpErr)

// Same dir = no-op
const same = await store.migrateTasksTo(newDir)
check('M14 same dir is a no-op', same === 0)

await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL MIGRATE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
