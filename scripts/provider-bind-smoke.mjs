// Provider binding smoke test: field-level merge into the workspace
// .opencode/opencode.json - unrelated user fields must survive, unbind
// removes only what we wrote, atomic writes, provenance reflects binding.
import { applyProviderBinding, resolveProviderProvenance } from '../packages/core/dist/index.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const tmp = join(process.env.TEMP || '/tmp', `sentinel-bind-test-${randomUUID().slice(0, 8)}`)
const taskDir = join(tmp, 'my-task')
const cfgPath = join(taskDir, '.opencode', 'opencode.json')
const sidecar = join(taskDir, '.opencode', '.sentinel-provider.json')
const read = () => fs.readFile(cfgPath, 'utf-8').then(JSON.parse)

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`OK   | ${name}`)
  else { failures++; console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`) }
}

// Pre-existing user config: permissions + mcp + an unrelated provider
await fs.mkdir(join(taskDir, '.opencode'), { recursive: true })
await fs.writeFile(cfgPath, JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  permission: { bash: 'allow' },
  mcp: { everything: { url: 'https://mcp.example.com' } },
  provider: {
    'user-own': { options: { baseURL: 'https://user.example.com', apiKey: 'user-key' } },
  },
}), 'utf-8')

// Bind
await applyProviderBinding(taskDir, {
  profileId: 'official-glm', provider: 'zai-coding-plan', model: 'glm-5.2',
  baseUrl: 'https://api.z.ai', apiKey: 'sk-secret',
})
let cfg = await read()
check('B1 model written', cfg.model === 'zai-coding-plan/glm-5.2', cfg.model)
check('B2 provider entry merged', cfg.provider['zai-coding-plan']?.options?.baseURL === 'https://api.z.ai', JSON.stringify(cfg.provider))
check('B3 user provider untouched', cfg.provider['user-own']?.options?.apiKey === 'user-key', JSON.stringify(cfg.provider))
check('B4 permissions untouched', cfg.permission?.bash === 'allow')
check('B5 mcp untouched', cfg.mcp?.everything?.url === 'https://mcp.example.com')
check('B6 sidecar records binding', (await fs.readFile(sidecar, 'utf-8').then(JSON.parse)).profileId === 'official-glm')
check('B7 no .tmp leftovers', await fs.readdir(join(taskDir, '.opencode')).then((f) => !f.some((x) => x.endsWith('.tmp'))))

// Provenance now resolves to the bound provider from the workspace layer
const prov = resolveProviderProvenance(taskDir, undefined, { globalConfigPath: join(tmp, 'none.json') })
check('B8 provenance sees binding', prov.provider === 'zai-coding-plan' && prov.model === 'glm-5.2' && prov.source === 'workspace', JSON.stringify(prov))
check('B9 provenance endpoint origin', prov.endpoint === 'https://api.z.ai', prov.endpoint)

// Rebind to another profile: old entry replaced cleanly
await applyProviderBinding(taskDir, {
  profileId: 'cheap', provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com',
})
cfg = await read()
check('B10 rebind switches model', cfg.model === 'deepseek/deepseek-chat')
check('B11 rebind keeps other entries', cfg.provider['zai-coding-plan'] !== undefined && cfg.provider['user-own'] !== undefined)
const sidecar2 = await fs.readFile(sidecar, 'utf-8').then(JSON.parse)
check('B12 sidecar updated', sidecar2.profileId === 'cheap' && sidecar2.provider === 'deepseek')

// Unbind: only our fields removed, user fields intact
await applyProviderBinding(taskDir, null)
cfg = await read()
check('B13 unbind removes model', cfg.model === undefined, cfg.model)
check('B14 unbind removes bound entry', cfg.provider.deepseek === undefined)
check('B15 unbind keeps user provider', cfg.provider['user-own']?.options?.apiKey === 'user-key')
check('B16 unbind keeps permissions/mcp', cfg.permission?.bash === 'allow' && cfg.mcp?.everything !== undefined)
check('B17 sidecar removed', await fs.access(sidecar).then(() => false, () => true))

// Unbind without sidecar: no-op, config untouched
const before = await read()
await applyProviderBinding(taskDir, null)
check('B18 unbind without sidecar is a no-op', JSON.stringify(await read()) === JSON.stringify(before))

await fs.rm(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n=== ALL BINDING TESTS PASSED ===' : `\n=== ${failures} TEST(S) FAILED ===`)
process.exit(failures === 0 ? 0 : 1)
