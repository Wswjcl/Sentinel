import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  // Rule-managed cards (workspaces configured): compile to ask-everything
  // so EVERY request routes through Sentinel - the rule engine answers
  // and audits each one (evaluatePermissionRequest below). The card's own
  // policies are then enforced by the rule layer, not by opencode.
  if (profile.workspaces && profile.workspaces.length > 0) {
    return { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: { '*': 'ask' } }
  }
  switch (profile.preset) {
    case 'readonly':
      // Look and report, change nothing without approval
      return { edit: 'deny', bash: 'ask', webfetch: 'ask', external_directory: { '*': profile.external ?? 'ask' } }
    case 'trusted':
      // Explicit allows so workspace overrides any stricter global config
      return { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: { '*': 'allow' } }
    case 'standard': {
      // Whole workspace writable, everything else asks first
      return { edit: 'allow', bash: 'ask', webfetch: 'ask', external_directory: { '*': profile.external ?? 'ask' } }
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
        external_directory: { '*': profile.external ?? 'ask' },
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

/** Log levels shared with the scheduler log panel. */
export type PermissionLogLevel = 'info' | 'warn'
export type PermissionLogFn = (level: PermissionLogLevel, msg: string) => void

/**
 * opencode roots a project at the enclosing git worktree and reads its
 * config from there - a workspace nested inside a foreign repo (e.g. a
 * Sentinel flow dir under the app repo, or a task dir under some parent
 * project) would never see its own .opencode config, silently dropping
 * the permission card. Make the workspace its own git root so the config
 * applies. No-op when the dir already has .git or is not inside any repo.
 *
 * Every state change (init performed, git unavailable, probe failure) is
 * reported through onLog - a silent failure here is exactly the
 * "card written but never enforced" bug this function exists to fix.
 */
function ensureOwnGitRoot(taskDir: string, onLog?: PermissionLogFn): void {
  if (existsSync(join(taskDir, '.git'))) return
  let top = ''
  try {
    const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: taskDir, timeout: 5000, encoding: 'utf-8',
    })
    if (probe.error || probe.status !== 0) {
      onLog?.('warn', `[perm] git unavailable for ${taskDir} - if the directory sits inside another repo, its .opencode config (and permission card) may not be enforced`)
      return
    }
    top = (probe.stdout ?? '').toString().trim()
  } catch {
    onLog?.('warn', `[perm] git probe failed for ${taskDir} - permission card may not be enforced in a nested repo`)
    return
  }
  if (!top) return // not inside any repo - config is read as-is
  const same = (a: string, b: string): boolean =>
    resolve(a).toLowerCase() === resolve(b).toLowerCase()
  if (same(top, taskDir)) return
  try {
    const init = spawnSync('git', ['init'], { cwd: taskDir, timeout: 10_000 })
    if (init.error || init.status !== 0) {
      onLog?.('warn', `[perm] git init failed for ${taskDir} - permission card may not be enforced (opencode reads config from the worktree root)`)
    } else {
      onLog?.('info', `[perm] initialized own git root in ${taskDir} so opencode applies this workspace's .opencode config`)
    }
  } catch {
    onLog?.('warn', `[perm] git init failed for ${taskDir} - permission card may not be enforced`)
  }
}

/** Apply a profile to the workspace .opencode config (null = clear and
 *  restore whatever permission config the user had before). onLog receives
 *  the git-root side effects for the scheduler log. */
export async function applyPermissionProfile(
  taskDir: string,
  profile: PermissionProfile | null,
  onLog?: PermissionLogFn,
): Promise<void> {
  const ocDir = join(taskDir, '.opencode')
  await mkdir(ocDir, { recursive: true })
  const configPath = join(ocDir, OPENCODE_CONFIG)
  const sidecarPath = join(ocDir, SIDECAR)

  const config = (await readJson<Record<string, unknown>>(configPath)) ?? {}
  const sidecar = await readJson<PermissionSidecar>(sidecarPath)

  if (profile) {
    ensureOwnGitRoot(taskDir, onLog)
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

// ─── Workspace rule engine (v3.6) ──────────────────────────────────
// Rule-managed cards (workspaces configured) route every permission
// request through here. Decisions are automatic and audited; only
// unmatched requests escalate to the human dialog. Enforced by the
// serve runtime (onPermission hook) and the claude runtime (canUseTool);
// the CLI runtime refuses rule-managed runs (no interception point).

/** Minimal shape both runtimes already have at their decision points. */
export interface PermissionRequestLike {
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
}

export interface RuleDecision {
  response: 'rule-allow' | 'rule-deny' | 'ask'
  /** Matched rule name, recorded in PermissionAskRecord.rule. */
  rule: string
}

const WRITE_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'applypatch', 'patch'])
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'list', 'view'])

/** Glob match. `pathMode`: `*` stops at path separators (editGlobs);
 *  otherwise `*` matches anything incl. spaces (bash command text). */
export function globMatch(pattern: string, text: string, pathMode = false): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, pathMode ? '[^/]*' : '.*')
    .replace(/\?/g, pathMode ? '[^/]' : '.')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(text)
}

function isInsideRoot(child: string, root: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  const rel = relative(norm(resolve(root)), norm(resolve(child)))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function requestPathOf(request: PermissionRequestLike): string | null {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = request.metadata?.[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const first = request.patterns[0]
  if (first) {
    const trimmed = first.trim()
    // A concrete path (absolute, or relative without glob characters)
    // evaluates; glob-shaped patterns cannot name a target - escalate.
    if (isAbsolute(trimmed) || !/[*?]/.test(trimmed)) return trimmed
  }
  return null
}

/**
 * Decide one permission request against a rule-managed card. `roots` are
 * the absolute workspace roots (task dir + card workspaces); `baseDir`
 * is where relative paths in requests resolve from (the task dir) and
 * what relative editGlobs match against.
 *
 * Outside every root: auto-deny. Inside: the card's own policies decide
 * (bash/webfetch by tool policy, writes by preset/globs, reads free).
 * Anything the rules can't classify escalates to the human dialog.
 */
export function evaluatePermissionRequest(
  profile: PermissionProfile,
  request: PermissionRequestLike,
  roots: string[],
  baseDir: string,
): RuleDecision {
  const tool = request.permission.toLowerCase()
  const first = request.patterns[0]?.trim() ?? ''

  // bash cannot be path-confined (a command's file access is not static)
  if (tool === 'bash') {
    for (const pattern of profile.bashDeny ?? []) {
      if (globMatch(pattern, first)) return { response: 'rule-deny', rule: `bash-deny(${pattern})` }
    }
    if (profile.bash === 'allow') return { response: 'rule-allow', rule: 'bash-allow' }
    if (profile.bash === 'deny') return { response: 'rule-deny', rule: 'bash-deny' }
    return { response: 'ask', rule: 'bash-ask' }
  }
  if (tool === 'webfetch' || tool === 'websearch') {
    if (profile.webfetch === 'allow') return { response: 'rule-allow', rule: 'webfetch-allow' }
    if (profile.webfetch === 'deny') return { response: 'rule-deny', rule: 'webfetch-deny' }
    return { response: 'ask', rule: 'webfetch-ask' }
  }

  const path = requestPathOf(request)
  if (!path) return { response: 'ask', rule: 'unmatched-tool' }

  const abs = isAbsolute(path) ? resolve(path) : resolve(baseDir, path)
  if (!roots.some((root) => isInsideRoot(abs, root))) {
    return { response: 'rule-deny', rule: 'outside-workspace' }
  }

  if (READ_TOOLS.has(tool)) return { response: 'rule-allow', rule: 'workspace-read' }
  if (WRITE_TOOLS.has(tool)) {
    if (profile.preset === 'readonly') return { response: 'rule-deny', rule: 'readonly-deny' }
    if (profile.preset === 'trusted') return { response: 'rule-allow', rule: 'workspace-edit' }
    if (profile.preset === 'custom') {
      const rel = relative(resolve(baseDir), abs).split(sep).join('/')
      const hit =
        (profile.editGlobs ?? []).some((glob) => globMatch(glob, rel, true) || globMatch(glob, abs, true))
      if (hit) return { response: 'rule-allow', rule: 'edit-glob-allow' }
      return { response: 'ask', rule: 'edit-glob-ask' }
    }
    // standard: whole workspace writable
    return { response: 'rule-allow', rule: 'workspace-edit' }
  }
  return { response: 'ask', rule: 'unmatched-tool' }
}
