import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { TaskConfig, TaskInfo, TaskRunRecord, TaskStatus } from './types.js'
import type { OpenCodeConfig } from './opencode-config.js'
import { getNextRun } from './cron.js'

const TASK_CONFIG_FILE = 'task.yaml'
const HISTORY_FILE = '.history.json'
const STATUS_FILE = '.status.json'
const OPENCODE_CONFIG_FILE = '.opencode/opencode.json'

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

  constructor(options: TaskStoreOptions) {
    this.tasksDir = options.tasksDir
  }

  async init(): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true })
    // Recover inconsistent states on startup
    await this.recoverStates()
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
    const entries = await fs.readdir(this.tasksDir, { withFileTypes: true })
    const names: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await fs.access(join(this.tasksDir, entry.name, TASK_CONFIG_FILE))
        names.push(entry.name)
      } catch {}
    }
    return names
  }

  getTaskDir(name: string): string {
    return join(this.tasksDir, name)
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
    const dir = join(this.tasksDir, name)
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(dir, TASK_CONFIG_FILE)
    await fs.writeFile(configPath, stringifyYaml(config), 'utf-8')
  }

  async deleteTask(name: string): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid task name: ${name}`)
    }
    await fs.rm(join(this.tasksDir, name), { recursive: true, force: true })
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
    const dir = join(this.tasksDir, name, '.opencode')
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(this.tasksDir, name, OPENCODE_CONFIG_FILE)
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
