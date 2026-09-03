#!/usr/bin/env node
/**
 * Permission profile smoke tests: compile logic + apply/clear round-trip
 * on temp dirs, including previous-config preservation semantics.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const coreDist = process.argv[2] ?? new URL('../packages/core/dist/', import.meta.url).pathname
const { compilePermissionConfig, applyPermissionProfile, hasPermissionProfile } = await import(
  pathToFileURL(join(coreDist, 'permissions.js')).href
)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`OK   | ${name}`)
  } else {
    fail++
    console.log(`FAIL | ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Compile logic ────────────────────────────────────────────────
const ro = compilePermissionConfig({ preset: 'readonly' })
check('readonly compiles', eq(ro, { edit: 'deny', bash: 'ask', webfetch: 'ask', external_directory: 'ask' }), JSON.stringify(ro))

const std = compilePermissionConfig({ preset: 'standard' })
check('standard compiles', eq(std, { edit: 'allow', bash: 'ask', webfetch: 'ask', external_directory: 'ask' }), JSON.stringify(std))

const tr = compilePermissionConfig({ preset: 'trusted' })
check('trusted compiles to explicit allows', eq(tr, { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: 'allow' }), JSON.stringify(tr))

const cu = compilePermissionConfig({
  preset: 'custom',
  editGlobs: ['src/**', 'docs/*.md'],
  bash: 'allow',
  bashDeny: ['rm *', 'git push*'],
  external: 'deny',
  webfetch: 'allow',
})
check('custom edit: catch-all first, globs after (last-match-wins)', eq(cu.edit, { '*': 'ask', 'src/**': 'allow', 'docs/*.md': 'allow' }), JSON.stringify(cu.edit))
check('custom bash: catch-all first, denies after', eq(cu.bash, { '*': 'allow', 'rm *': 'deny', 'git push*': 'deny' }), JSON.stringify(cu.bash))
check('custom external_directory deny', cu.external_directory === 'deny')

const cuMinimal = compilePermissionConfig({ preset: 'custom' })
check('custom falls back to ask defaults', cuMinimal.bash['*'] === 'ask' && cuMinimal.external_directory === 'ask' && cuMinimal.edit['*'] === 'ask')

// ── Apply / clear round-trip ─────────────────────────────────────
const base = await mkdtemp(join(tmpdir(), 'sentinel-perm-'))
try {
  const taskDir = join(base, 'task')
  await mkdir(join(taskDir, '.opencode'), { recursive: true })
  const configPath = join(taskDir, '.opencode', 'opencode.json')

  // Apply onto an existing user config with a hand-written permission block
  await writeFile(configPath, JSON.stringify({ $schema: 'x', permission: { bash: 'deny' }, mcp: { a: 1 } }, null, 2))

  check('no profile initially', (await hasPermissionProfile(taskDir)) === false)
  await applyPermissionProfile(taskDir, { preset: 'standard' })
  check('profile applied', (await hasPermissionProfile(taskDir)) === true)

  let config = JSON.parse(await readFile(configPath, 'utf-8'))
  check('permission section replaced by compiled profile', eq(config.permission, std), JSON.stringify(config.permission))
  check('non-permission keys untouched', eq(config.mcp, { a: 1 }) && config.$schema === 'x')

  const sidecar = JSON.parse(await readFile(join(taskDir, '.opencode', '.sentinel-permissions.json'), 'utf-8'))
  check('previous user permission preserved in sidecar', eq(sidecar.previous, { bash: 'deny' }), JSON.stringify(sidecar))

  // Re-apply a different profile: sidecar must keep the ORIGINAL previous
  await applyPermissionProfile(taskDir, { preset: 'trusted' })
  config = JSON.parse(await readFile(configPath, 'utf-8'))
  check('second apply replaces permission', eq(config.permission, tr))
  const sidecar2 = JSON.parse(await readFile(join(taskDir, '.opencode', '.sentinel-permissions.json'), 'utf-8'))
  check('sidecar still holds original previous', eq(sidecar2.previous, { bash: 'deny' }))

  // Clear: restore the user's original permission config
  await applyPermissionProfile(taskDir, null)
  check('cleared', (await hasPermissionProfile(taskDir)) === false)
  config = JSON.parse(await readFile(configPath, 'utf-8'))
  check('user permission restored', eq(config.permission, { bash: 'deny' }), JSON.stringify(config.permission))
  check('mcp still intact after clear', eq(config.mcp, { a: 1 }))

  // Clear again without sidecar: no-op, must not throw
  await applyPermissionProfile(taskDir, null)
  check('double clear is a no-op', true)

  // Apply onto a config with NO permission key: clear removes the key entirely
  await rm(join(taskDir, '.opencode', '.sentinel-permissions.json'), { force: true })
  await writeFile(configPath, JSON.stringify({ model: 'x/y' }))
  await applyPermissionProfile(taskDir, { preset: 'readonly' })
  await applyPermissionProfile(taskDir, null)
  config = JSON.parse(await readFile(configPath, 'utf-8'))
  check('clear removes generated permission key when there was none before', !('permission' in config) && config.model === 'x/y', JSON.stringify(config))
} finally {
  await rm(base, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
