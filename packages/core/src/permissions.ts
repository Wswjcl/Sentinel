import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PermissionLevel, PermissionProfile } from './types.js'

/**
 * Permission profiles: compile a user-friendly permission card (preset +
 * writable globs + tool policies) into the task workspace's
 * .opencode/opencode.json `permission` section, which opencode natively
 * enforces (workspace config wins over global).
 *
 * Merge discipline mirrors provider-bind.ts: the whole `permission` key is
 * Sentinel-owned only while a profile is active. The user's pre-existing
 * permission config (if any) is preserved in a sidecar and restored on
 * clear, so enabling/disabling the card never loses hand-written rules.
 *
 * opencode semantics (as of the docs): a permission is "allow" | "ask" |
 * "deny", optionally an object mapping glob patterns to values where the
 * LAST matching pattern wins - so catch-all patterns must come first.
 * `external_directory` gates every tool access to paths outside the
 * workspace, including reads.
 */

const OPENCODE_CONFIG = 'opencode.json'
const SIDECAR = '.sentinel-permissions.json'

/** Sidecar: what Sentinel wrote, plus the permission config it replaced. */
interface PermissionSidecar {
  previous?: unknown
}

/** The compiled permission object forms, one per preset/custom choice. */
export function compilePermissionConfig(profile: PermissionProfile): Record<string, unknown> {
  switch (profile.preset) {
    case 'readonly':
      // Look and report, change nothing without approval
      return { edit: 'deny', bash: 'ask', webfetch: 'ask', external_directory: profile.external ?? 'ask' }
    case 'trusted':
      // Explicit allows so workspace overrides any stricter global config
      return { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: 'allow' }
    case 'standard': {
      // Whole workspace writable, everything else asks first
      return { edit: 'allow', bash: 'ask', webfetch: 'ask', external_directory: profile.external ?? 'ask' }
    }
    case 'custom': {
      const edit: Record<string, unknown> = { '*': 'ask' }
      for (const glob of profile.editGlobs ?? []) edit[`${glob}`] = 'allow'
      const bash: Record<string, unknown> = { '*': profile.bash ?? 'ask' }
      for (const pattern of profile.bashDeny ?? []) bash[`${pattern}`] = 'deny'
      return {
        edit,
        bash,
        webfetch: profile.webfetch ?? 'ask',
        external_directory: profile.external ?? 'ask',
      }
    }
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Apply a profile to the workspace .opencode config (null = clear and
 *  restore whatever permission config the user had before). */
export async function applyPermissionProfile(
  taskDir: string,
  profile: PermissionProfile | null,
): Promise<void> {
  const ocDir = join(taskDir, '.opencode')
  await mkdir(ocDir, { recursive: true })
  const configPath = join(ocDir, OPENCODE_CONFIG)
  const sidecarPath = join(ocDir, SIDECAR)

  const config = (await readJson<Record<string, unknown>>(configPath)) ?? {}
  const sidecar = await readJson<PermissionSidecar>(sidecarPath)

  if (profile) {
    // Preserve a non-Sentinel permission config exactly once, on first apply
    const previous = sidecar?.previous !== undefined ? sidecar.previous : config.permission
    config.permission = compilePermissionConfig(profile)
    await writeJsonAtomic(configPath, config)
    await writeJsonAtomic(sidecarPath, { previous } satisfies PermissionSidecar)
    return
  }

  // Clear: restore the previous permission config, drop the sidecar
  if (!sidecar) return
  if (sidecar.previous === undefined) delete config.permission
  else config.permission = sidecar.previous
  await writeJsonAtomic(configPath, config)
  await rm(sidecarPath, { force: true })
}

/** Whether Sentinel currently manages the workspace's permission config. */
export async function hasPermissionProfile(taskDir: string): Promise<boolean> {
  try {
    await readFile(join(taskDir, '.opencode', SIDECAR), 'utf-8')
    return true
  } catch {
    return false
  }
}
