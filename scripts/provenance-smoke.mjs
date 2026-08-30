// Provider provenance smoke test: resolution priority (override > workspace
// > global), provider/model split, endpoint origin extraction, no secrets.
import { resolveProviderProvenance } from '../packages/core/dist/index.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const tmp = join(process.env.TEMP || '/tmp', `sentinel-prov-test-${randomUUID().slice(0, 8)}`)
const taskDir = join(tmp, 'my-task')
const globalCfg = join(tmp, 'global-opencode.json')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

const opts = { globalConfigPath: globalCfg }

// No configs at all -> empty provenance, no throw
const e0 = resolveProviderProvenance(taskDir, undefined, opts)
check('P1 empty when nothing configured', !e0.provider && !e0.model && !e0.endpoint)

// Global only
await fs.mkdir(join(tmp, 'x'), { recursive: true })
await fs.writeFile(globalCfg, JSON.stringify({
  model: 'zai-coding-plan/glm-5.2',
  provider: { 'zai-coding-plan': { options: { baseURL: 'https://api.example.com/v1?token=secret', apiKey: 'sk-DO-NOT-LEAK' } } },
}), 'utf-8')
const e1 = resolveProviderProvenance(taskDir, undefined, opts)
check('P2 global fallback', e1.provider === 'zai-coding-plan' && e1.model === 'glm-5.2', JSON.stringify(e1))
check('P3 source=global', e1.source === 'global')
check('P4 endpoint origin only', e1.endpoint === 'https://api.example.com', e1.endpoint)
check('P5 apiKey never surfaced', !JSON.stringify(e1).includes('sk-DO-NOT-LEAK'), JSON.stringify(e1))

// Workspace overrides global
await fs.mkdir(join(taskDir, '.opencode'), { recursive: true })
await fs.writeFile(join(taskDir, '.opencode', 'opencode.json'), JSON.stringify({
  model: 'deepseek/deepseek-chat',
  provider: { deepseek: { options: { baseURL: 'https://api.deepseek.com' } } },
}), 'utf-8')
const e2 = resolveProviderProvenance(taskDir, undefined, opts)
check('P6 workspace overrides global', e2.provider === 'deepseek' && e2.model === 'deepseek-chat', JSON.stringify(e2))
check('P7 source=workspace', e2.source === 'workspace')
check('P8 workspace endpoint', e2.endpoint === 'https://api.deepseek.com', e2.endpoint)

// Explicit model override wins over both; provider comes from the override
const e3 = resolveProviderProvenance(taskDir, 'zai-coding-plan/glm-4.7', opts)
check('P9 override wins', e3.provider === 'zai-coding-plan' && e3.model === 'glm-4.7', JSON.stringify(e3))
// endpoint falls back to the layer declaring that provider (global)
check('P10 endpoint from declaring layer', e3.endpoint === 'https://api.example.com', e3.endpoint)

// Bare model id (no provider)
const e4 = resolveProviderProvenance(taskDir, 'glm-5.2', opts)
check('P11 bare override keeps model only', e4.model === 'glm-5.2' && e4.provider === undefined, JSON.stringify(e4))

// Malformed workspace config -> falls through to global, no throw
await fs.writeFile(join(taskDir, '.opencode', 'opencode.json'), '{ broken', 'utf-8')
const e5 = resolveProviderProvenance(taskDir, undefined, opts)
check('P12 broken workspace falls back to global', e5.provider === 'zai-coding-plan' && e5.source === 'global', JSON.stringify(e5))

await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL PROVENANCE TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
