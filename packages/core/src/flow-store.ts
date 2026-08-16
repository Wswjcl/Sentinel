import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { isValidTaskName } from './task-store.js'
import type { FlowConfig, FlowRun } from './types.js'

const FLOW_CONFIG_FILE = 'flow.yaml'
const RUNS_FILE = '.runs.json'
/** Runs carry node outputs - cap history so flows don't grow unbounded. */
const MAX_RUNS = 50

export interface FlowStoreOptions {
  flowsDir: string
}

export class FlowStore {
  private flowsDir: string

  constructor(options: FlowStoreOptions) {
    this.flowsDir = options.flowsDir
  }

  async init(): Promise<void> {
    await fs.mkdir(this.flowsDir, { recursive: true })
  }

  async listFlows(): Promise<string[]> {
    const entries = await fs.readdir(this.flowsDir, { withFileTypes: true })
    const names: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await fs.access(join(this.flowsDir, entry.name, FLOW_CONFIG_FILE))
        names.push(entry.name)
      } catch {}
    }
    return names
  }

  getFlowDir(name: string): string {
    return join(this.flowsDir, name)
  }

  /** Safely resolve a path under a flow directory, preventing traversal */
  private safeFlowPath(name: string, ...segments: string[]): string {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid flow name: ${name}`)
    }
    const base = this.getFlowDir(name)
    const target = resolve(base, ...segments)
    if (!target.startsWith(resolve(base))) {
      throw new Error(`Path traversal detected: ${segments.join('/')}`)
    }
    return target
  }

  async getConfig(name: string): Promise<FlowConfig> {
    const configPath = this.safeFlowPath(name, FLOW_CONFIG_FILE)
    const raw = await fs.readFile(configPath, 'utf-8')
    return parseYaml(raw) as FlowConfig
  }

  async saveConfig(name: string, config: FlowConfig): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid flow name: ${name}`)
    }
    const dir = this.getFlowDir(name)
    await fs.mkdir(dir, { recursive: true })
    const configPath = this.safeFlowPath(name, FLOW_CONFIG_FILE)
    await fs.writeFile(configPath, stringifyYaml(config), 'utf-8')
  }

  async deleteFlow(name: string): Promise<void> {
    if (!isValidTaskName(name)) {
      throw new Error(`Invalid flow name: ${name}`)
    }
    await fs.rm(this.getFlowDir(name), { recursive: true, force: true })
  }

  async getRuns(name: string): Promise<FlowRun[]> {
    const runsPath = this.safeFlowPath(name, RUNS_FILE)
    try {
      const raw = await fs.readFile(runsPath, 'utf-8')
      return JSON.parse(raw) as FlowRun[]
    } catch {
      return []
    }
  }

  async saveRuns(name: string, runs: FlowRun[]): Promise<void> {
    const runsPath = this.safeFlowPath(name, RUNS_FILE)
    await fs.writeFile(runsPath, JSON.stringify(runs, null, 2), 'utf-8')
  }

  /** Insert or update a single run (upsert by run id), trimming history. */
  async saveRun(name: string, run: FlowRun): Promise<void> {
    const runs = await this.getRuns(name)
    const idx = runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) runs[idx] = run
    else runs.push(run)
    await this.saveRuns(name, runs.slice(-MAX_RUNS))
  }
}
