import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { TaskConfig, TaskInfo, TaskRunRecord, TaskStatus } from './types.js'
import type { OpenCodeConfig } from './opencode-config.js'
import { getNextRun } from './cron.js'

const TASK_CONFIG_FILE = 'task.yaml'
const HISTORY_FILE = '.history.json'
const OPENCODE_CONFIG_FILE = '.opencode/opencode.json'

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

  async getConfig(name: string): Promise<TaskConfig> {
    const configPath = join(this.tasksDir, name, TASK_CONFIG_FILE)
    const raw = await fs.readFile(configPath, 'utf-8')
    return parseYaml(raw) as TaskConfig
  }

  async saveConfig(name: string, config: TaskConfig): Promise<void> {
    const dir = join(this.tasksDir, name)
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(dir, TASK_CONFIG_FILE)
    await fs.writeFile(configPath, stringifyYaml(config), 'utf-8')
  }

  async deleteTask(name: string): Promise<void> {
    await fs.rm(join(this.tasksDir, name), { recursive: true, force: true })
  }

  async getOpenCodeConfig(name: string): Promise<OpenCodeConfig | null> {
    const configPath = join(this.tasksDir, name, OPENCODE_CONFIG_FILE)
    try {
      const raw = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(raw) as OpenCodeConfig
    } catch {
      return null
    }
  }

  async saveOpenCodeConfig(name: string, config: OpenCodeConfig): Promise<void> {
    const dir = join(this.tasksDir, name, '.opencode')
    await fs.mkdir(dir, { recursive: true })
    const configPath = join(this.tasksDir, name, OPENCODE_CONFIG_FILE)
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  async getHistory(name: string): Promise<TaskRunRecord[]> {
    const historyPath = join(this.tasksDir, name, HISTORY_FILE)
    try {
      const raw = await fs.readFile(historyPath, 'utf-8')
      return JSON.parse(raw) as TaskRunRecord[]
    } catch {
      return []
    }
  }

  async saveHistory(name: string, history: TaskRunRecord[]): Promise<void> {
    const historyPath = join(this.tasksDir, name, HISTORY_FILE)
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8')
  }

  async getTaskInfo(name: string): Promise<TaskInfo> {
    const config = await this.getConfig(name)
    const history = await this.getHistory(name)

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

    const latestRecord = history[history.length - 1]
    let status: TaskStatus = 'pending'
    if (latestRecord) {
      if (latestRecord.status === 'running') status = 'running'
      else if (latestRecord.status === 'success') status = 'scheduled'
      else status = 'failed'
    }

    if (!lastRun && !nextRun) status = 'pending'

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

  async setStatus(name: string, status: TaskStatus): Promise<void> {
    // Status is derived from history — no persistent field to update directly
    // The scheduler uses this conceptually; actual state = latest history record
    void name
    void status
  }
}
