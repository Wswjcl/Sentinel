import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { TaskConfig, TaskInfo, TaskRunRecord, TaskStatus } from './types.js'
import type { OpenCodeConfig } from './opencode-config.js'
import { getNextRun } from './cron.js'

const TASK_CONFIG_FILE = 'task.yaml'
const HISTORY_FILE = '.history.json'
const STATUS_FILE = '.status.json'
const OPENCODE_CONFIG_FILE = '.opencode/opencode.json'
/** Registry: task name -> workspace directory ("one dir = one task"). */
const REGISTRY_FILE = 'tasks.json'

/** Normalize a path for comparisons: forward slashes, no trailing
 *  slash, case-insensitive on Windows. */
function normPath(p: string): string {
  const r = resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Whether `child` equals or lies inside `parent` (both absolute). */
function isInside(child: string, parent: string): boolean {
  const c = normPath(child)
  const p = normPath(parent)
  return c === p || c.startsWith(p + '/')
}

/** Validate task name — prevent path traversal */
export function isValidTaskName(name: string): boolean {
  if (!name || name.length === 0) return false
  if (name.includes('..')) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.startsWith('.')) return false
  if (name.length > 128) return false
  // Allow alphanumeric, dashes, underscores
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

export interface TaskStoreOptions {
  tasksDir: string
}

export class TaskStore {
  private tasksDir: string
  /** Task name -> absolute workspace dir. The workspace holds
   *  everything (task.yaml, history, status, .opencode); the data dir
   *  only stores this index. */
  private dirs = new Map<string, string>()
  private registryLoaded = false

  constructor(options: TaskStoreOptions) {
    this.tasksDir = options.tasksDir
  }

  async init(): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true })
    await this.loadRegistry()
    // Recover inconsistent states on startup
    await this.recoverStates()
  }

  /** Load the name->dir registry. Legacy tasks living directly under
   *  tasksDir are adopted in place (their dir stays where it is). */
  private async loadRegistry(): Promise<void> {
    if (this.registryLoaded) return
    let dirty = false
    try {
      const raw = await fs.readFile(join(this.tasksDir, REGISTRY_FILE), 'utf-8')
      const parsed = JSON.parse(raw) as { tasks?: Record<string, string> }
      for (const [name, dir] of Object.entries(parsed.tasks ?? {})) {
        if (isValidTaskName(name) && typeof dir === 'string' && dir.length > 0) {
          this.dirs.set(name, resolve(dir))
        }
      }
    } catch {}
    // Adopt legacy tasks: any tasksDir/<name> with a task.yaml but no
    // registry entry keeps living where it is
    let entries: Dirent[]
    try {
      entries = await fs.readdir(this.tasksDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidTaskName(entry.name)) continue
      try {
        await fs.access(join(this.tasksDir, entry.name, TASK_CONFIG_FILE))
        if (!this.dirs.has(entry.name)) {
          this.dirs.set(entry.name, join(this.tasksDir, entry.name))
          dirty = true
        }
      } catch {}
    }
    if (dirty) await this.persistRegistry()
    this.registryLoaded = true
  }

  private async persistRegistry(): Promise<void> {
    const tasks: Record<string, string> = {}
    for (const name of [...this.dirs.keys()].sort()) {
      tasks[name] = this.dirs.get(name)!
    }
    await fs.mkdir(this.tasksDir, { recursive: true })
    await fs.writeFile(
      join(this.tasksDir, REGISTRY_FILE),
      JSON.stringify({ version: 1, tasks }, null, 2),
      'utf-8',
    )
  }

  /** Fix orphaned 'running' states from crashed scheduler runs */
  private async recoverStates(): Promise<void> {
    const names = await this.listTasks()
    for (const name of names) {
      const status = await this.readStatus(name)
      if (status === 'running') {
        // Scheduler is not running at this point, so any 'running'
        // state is stale — reset to 'failed'
        await this.writeStatus(name, 'failed')
      }
    }
  }

  async listTasks(): Promise<string[]> {
    await this.loadRegistry()
    return [...this.dirs.keys()].sort()
  }

  getTaskDir(name: string): string {
    // Unregistered names fall back to the legacy data-dir location
    // (direct workspace writes, e.g. fixtures, keep working)
    return this.dirs.get(name) ?? join(this.tasksDir, name)
  }

  /** Current tasks directory (registry home + default workspace parent). */
  getTasksDir(): string {
    return this.tasksDir
  }

  /** Relocate the tasks directory: workspaces living inside the old
   *  tasks dir are MOVED into the new one (copy, then remove the old
   *  copy); external workspaces stay put and are only re-registered.
   *  The store switches over immediately and the registry is rewritten
   *  at the new location. Returns the number of workspaces moved. */
  async migrateTasksTo(newTasksDir: string): Promise<number> {
    const target = resolve(newTasksDir)
    if (normPath(target) === normPath(this.tasksDir)) return 0
    if (isInside(target, this.tasksDir) || isInside(this.tasksDir, target)) {
      throw new Error('New tasks directory must not overlap the current one')
    }
    await this.loadRegistry()
    await fs.mkdir(target, { recursive: true })
    const moved = new Map<string, string>()
    for (const [name, dir] of this.dirs) {
      if (!isInside(dir, this.tasksDir)) continue // external workspace
      const dest = join(target, basename(dir))
      try {
        await fs.access(dest)
        throw new Error(`Target already exists: ${dest}`)
      } catch (err) {
        if ((err as Error).message.startsWith('Target already exists')) throw err
      }
      await fs.cp(dir, dest, { recursive: true })
      await fs.rm(dir, { recursive: true, force: true })
      moved.set(name, dest)
    }
    for (const [name, dest] of moved) this.dirs.set(name, dest)
    this.tasksDir = target
    await this.persistRegistry()
    return moved.size
  }

  /** Register a task workspace: the directory becomes the task's home
   *  (config, history, status, .opencode all live there). Rejects
   *  duplicate names and directories already owned by another task. */
  async createTask(name: string, dir: string): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    await this.loadRegistry()
    if (this.dirs.has(name)) {
      throw new Error(`Workspace already exists: ${name}`)
    }
    const abs = resolve(dir)
    if (normPath(abs) === normPath(this.tasksDir)) {
      throw new Error('Task directory cannot be the Sentinel tasks directory itself')
    }
    const taken = [...this.dirs.entries()].find(([, d]) => normPath(d) === normPath(abs))
    if (taken) {
      throw new Error(`Directory is already used by task "${taken[0]}"`)
    }
    await fs.mkdir(abs, { recursive: true })
    this.dirs.set(name, abs)
    await this.persistRegistry()
  }

  /** Safely resolve a path under a task directory, preventing traversal */
  private safeTaskPath(name: string, ...segments: string[]): string {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    const base = this.getTaskDir(name)
    const target = resolve(base, ...segments)
    if (!target.startsWith(resolve(base))) {
      throw new Error(`Path traversal detected: ${segments.join('/')}`)
    }
    return target
  }

  async getConfig(name: string): Promise<TaskConfig> {
    const configPath = this.safeTaskPath(name, TASK_CONFIG_FILE)
    const raw = await fs.readFile(configPath, 'utf-8')
    return parseYaml(raw) as TaskConfig
  }

  async saveConfig(name: string, config: TaskConfig): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    const dir = this.getTaskDir(name)
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(dir, TASK_CONFIG_FILE)
    await fs.writeFile(configPath, stringifyYaml(config), 'utf-8')
  }

  async deleteTask(name: string): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    await this.loadRegistry()
    const dir = this.getTaskDir(name)
    if (isInside(dir, this.tasksDir)) {
      // Sentinel-owned workspace (legacy/CLI default location): remove
      // the whole directory, as before
      await fs.rm(dir, { recursive: true, force: true })
    } else {
      // User directory: remove only Sentinel's metadata files, keep
      // everything else (it's the user's project)
      await Promise.all(
        [
          join(dir, TASK_CONFIG_FILE),
          join(dir, HISTORY_FILE),
          join(dir, STATUS_FILE),
          join(dir, OPENCODE_CONFIG_FILE),
        ].map((p) => fs.rm(p, { force: true })),
      )
    }
    this.dirs.delete(name)
    await this.persistRegistry()
  }

  async getOpenCodeConfig(name: string): Promise<OpenCodeConfig | null> {
    const configPath = this.safeTaskPath(name, OPENCODE_CONFIG_FILE)
    try {
      const raw = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(raw) as OpenCodeConfig
    } catch {
      return null
    }
  }

  async saveOpenCodeConfig(name: string, config: OpenCodeConfig): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    const dir = join(this.getTaskDir(name), '.opencode')
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(this.getTaskDir(name), OPENCODE_CONFIG_FILE)
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  async getHistory(name: string): Promise<TaskRunRecord[]> {
    const historyPath = this.safeTaskPath(name, HISTORY_FILE)
    try {
      const raw = await fs.readFile(historyPath, 'utf-8')
      return JSON.parse(raw) as TaskRunRecord[]
    } catch {
      return []
    }
  }

  async saveHistory(name: string, history: TaskRunRecord[]): Promise<void> {
    const historyPath = this.safeTaskPath(name, HISTORY_FILE)
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8')
  }

  // --- Persisted status (replaces the old no-op setStatus) ---

  private async readStatus(name: string): Promise<TaskStatus | null> {
    const statusPath = this.safeTaskPath(name, STATUS_FILE)
    try {
      const raw = await fs.readFile(statusPath, 'utf-8')
      return JSON.parse(raw).status as TaskStatus
    } catch {
      return null
    }
  }

  private async writeStatus(name: string, status: TaskStatus): Promise<void> {
    const statusPath = this.safeTaskPath(name, STATUS_FILE)
    await fs.writeFile(statusPath, JSON.stringify({ status, updatedAt: new Date().toISOString() }), 'utf-8')
  }

  async setStatus(name: string, status: TaskStatus): Promise<void> {
    await this.writeStatus(name, status)
  }

  async getStatus(name: string): Promise<TaskStatus | null> {
    return this.readStatus(name)
  }

  // --- Composite info ---

  async getTaskInfo(name: string): Promise<TaskInfo> {
    const config = await this.getConfig(name)
    const history = await this.getHistory(name)
    const persistedStatus = await this.readStatus(name)

    const lastRun = history.length > 0
      ? history[history.length - 1].startedAt
      : undefined

    let nextRun: string | undefined
    try {
      nextRun = getNextRun(
        config.schedule.expr,
        config.schedule.timezone,
      ).toISOString()
    } catch {}

    // Status priority: persisted status > derived from history
    let status: TaskStatus = 'pending'
    if (persistedStatus) {
      status = persistedStatus
    } else {
      const latestRecord = history[history.length - 1]
      if (latestRecord) {
        if (latestRecord.status === 'running') status = 'running'
        else if (latestRecord.status === 'success') status = 'scheduled'
        else status = 'failed'
      }
      if (!lastRun && !nextRun) status = 'pending'
    }

    return {
      config,
      dir: this.getTaskDir(name),
      status,
      lastRun,
      nextRun,
      runCount: history.length,
      history,
    }
  }
}
