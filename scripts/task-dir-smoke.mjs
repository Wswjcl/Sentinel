// Task directory registry smoke test — "one dir = one task":
// external workspaces, uniqueness rules, delete semantics, legacy adoption.
import { TaskStore } from '../packages/core/dist/index.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const tmp = join(process.env.TEMP || '/tmp', `sentinel-taskdir-test-${randomUUID().slice(0, 8)}`)
const tasksDir = join(tmp, 'data', 'tasks')
const projectsDir = join(tmp, 'projects')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

function taskConfig(name) {
  return `name: ${name}\ndescription: smoke\nversion: 1\nschedule:\n  type: once\n  expr: "now"\nexecution:\n  prompt: hi\n`
}

await fs.mkdir(projectsDir, { recursive: true })

// ── Setup: a legacy task living directly under the data tasksDir ──
await fs.mkdir(join(tasksDir, 'legacy-task'), { recursive: true })
await fs.writeFile(join(tasksDir, 'legacy-task', 'task.yaml'), taskConfig('legacy-task'), 'utf-8')

// ── Legacy adoption on init ──
const store = new TaskStore({ tasksDir })
await store.init()
check('S1 legacy task adopted into registry', (await store.listTasks()).includes('legacy-task'))
check('S1 legacy task keeps its data-dir location', store.getTaskDir('legacy-task') === join(tasksDir, 'legacy-task'))

// ── External workspace creation ──
const extDir = join(projectsDir, 'my-project')
await store.createTask('ext-task', extDir)
await store.saveConfig('ext-task', { name: 'ext-task', description: 'x', version: 1, schedule: { type: 'once', expr: 'now' }, execution: { prompt: 'hi' } })
check('S2 external task listed', (await store.listTasks()).includes('ext-task'))
check('S2 getTaskDir points at the user directory', store.getTaskDir('ext-task') === extDir)
const onDisk = await fs.readFile(join(extDir, 'task.yaml'), 'utf-8')
check('S2 task.yaml written INTO the user directory', onDisk.includes('name: ext-task'))
const cfg = await store.getConfig('ext-task')
check('S2 config reads back from the user directory', cfg.name === 'ext-task')

// ── Uniqueness rules ──
let dupDir = null
try { await store.createTask('other-task', extDir) } catch (err) { dupDir = String(err.message) }
check('S3 same directory rejected', dupDir !== null && dupDir.includes('already used by task "ext-task"'), dupDir)
let dupName = null
try { await store.createTask('ext-task', join(projectsDir, 'other')) } catch (err) { dupName = String(err.message) }
check('S3 duplicate name rejected', dupName !== null && dupName.includes('already exists'), dupName)
let selfDir = null
try { await store.createTask('bad-task', tasksDir) } catch (err) { selfDir = String(err.message) }
check('S3 tasksDir itself rejected as workspace', selfDir !== null && selfDir.includes('cannot be the Sentinel tasks directory'), selfDir)

// ── Registry persists across instances ──
const store2 = new TaskStore({ tasksDir })
await store2.init()
check('S4 registry reloads (external task found)', (await store2.listTasks()).includes('ext-task'))
check('S4 registry reloads (dir preserved)', store2.getTaskDir('ext-task') === extDir)

// ── Delete semantics ──
// External dir: user files survive, only Sentinel metadata removed
await fs.writeFile(join(extDir, 'README.md'), 'user content', 'utf-8')
await fs.mkdir(join(extDir, '.opencode'), { recursive: true })
await fs.writeFile(join(extDir, '.opencode', 'opencode.json'), '{}', 'utf-8')
await store2.deleteTask('ext-task')
check('S5 external delete: unregistered', !(await store2.listTasks()).includes('ext-task'))
check('S5 external delete: user file kept', await fs.readFile(join(extDir, 'README.md'), 'utf-8').then(() => true, () => false))
check('S5 external delete: task.yaml removed', await fs.access(join(extDir, 'task.yaml')).then(() => false, () => true))
check('S5 external delete: opencode.json removed', await fs.access(join(extDir, '.opencode', 'opencode.json')).then(() => false, () => true))
// Data-dir (legacy) task: whole directory removed
await store2.deleteTask('legacy-task')
check('S5 legacy delete: whole dir removed', await fs.access(join(tasksDir, 'legacy-task')).then(() => false, () => true))
check('S5 delete: registry updated', !(await store2.listTasks()).includes('legacy-task'))

// ── Re-create after delete in the same directory works ──
await store2.createTask('fresh-task', extDir)
await store2.saveConfig('fresh-task', { name: 'fresh-task', description: 'x', version: 1, schedule: { type: 'once', expr: 'now' }, execution: { prompt: 'hi' } })
check('S6 re-create in same dir after delete', (await store2.getConfig('fresh-task')).name === 'fresh-task')
check('S6 user file still intact', await fs.readFile(join(extDir, 'README.md'), 'utf-8').then(() => true, () => false))

// cleanup
await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL TASK-DIR TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
