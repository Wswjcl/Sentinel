import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { executeTask } from './executor.js'
import { resolveShell } from './verification.js'
import { FlowStore } from './flow-store.js'
import { TaskStore, isValidTaskName } from './task-store.js'
import { sentinelEvents } from './events.js'
import type {
  AIFlowNode,
  FlowConfig,
  FlowNodeRun,
  FlowRun,
  ManualFlowNode,
  ScriptFlowNode,
  TaskConfig,
} from './types.js'

// ─── Validation ─────────────────────────────────────────────

export interface FlowValidationResult {
  valid: boolean
  errors: string[]
}

/** Validate a flow config: node shape, dependency references, cycles. */
export function validateFlow(config: FlowConfig): FlowValidationResult {
  const errors: string[] = []

  if (!config?.name || !isValidTaskName(config.name)) {
    errors.push(`invalid flow name: ${config?.name}`)
  }

  const nodes = config?.nodes ?? {}
  const nodeNames = Object.keys(nodes)
  if (nodeNames.length === 0) {
    errors.push('flow has no nodes')
  }

  for (const [name, node] of Object.entries(nodes)) {
    if (!name || !isValidTaskName(name)) {
      errors.push(`invalid node name: "${name}"`)
    }
    if (!node?.type) {
      errors.push(`node "${name}" has no type`)
      continue
    }
    if ((node.needs ?? []).includes(name)) {
      errors.push(`node "${name}" depends on itself`)
    }
    for (const dep of node.needs ?? []) {
      if (!(dep in nodes)) {
        errors.push(`node "${name}" needs unknown node "${dep}"`)
      }
    }
    if (node.type === 'ai' && !node.task) {
      errors.push(`ai node "${name}" requires a task reference`)
    }
    if (node.type === 'script' && !node.run) {
      errors.push(`script node "${name}" requires a run command`)
    }
  }

  // Cycle detection (Kahn's algorithm)
  if (nodeNames.length > 0) {
    const dependents: Record<string, string[]> = {}
    const indegree: Record<string, number> = {}
    for (const n of nodeNames) {
      dependents[n] = []
      indegree[n] = new Set(nodes[n].needs ?? []).size
    }
    for (const [name, node] of Object.entries(nodes)) {
      for (const dep of new Set(node.needs ?? [])) {
        if (dep in dependents) dependents[dep].push(name)
      }
    }
    const queue = nodeNames.filter((n) => indegree[n] === 0)
    let visited = 0
    while (queue.length > 0) {
      const n = queue.shift()!
      visited++
      for (const m of dependents[n]) {
        if (--indegree[m] === 0) queue.push(m)
      }
    }
    if (visited !== nodeNames.length) {
      errors.push('flow graph contains a cycle')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Engine ─────────────────────────────────────────────────

export interface FlowEngineOptions {
  flowStore: FlowStore
  taskStore: TaskStore
  opencodeBin?: string
  /** Default parallel-node limit when the flow doesn't set one (default 3). */
  concurrency?: number
  onLog?: (level: string, msg: string) => void
}

export interface FlowRunOptions {
  /** Run inputs, referenced via {inputs.key} placeholders. */
  inputs?: Record<string, string>
}

/**
 * DAG execution engine: runs a flow's nodes in dependency order,
 * launching dependency-free nodes in parallel (bounded by the flow's
 * concurrency). Node state is persisted after every transition so an
 * interrupted run leaves a complete trace.
 */
export class FlowEngine {
  private flowStore: FlowStore
  private taskStore: TaskStore
  private opencodeBin: string
  private concurrency: number
  private onLog?: (level: string, msg: string) => void

  constructor(options: FlowEngineOptions) {
    this.flowStore = options.flowStore
    this.taskStore = options.taskStore
    this.opencodeBin = options.opencodeBin ?? 'opencode'
    this.concurrency = options.concurrency ?? 3
    this.onLog = options.onLog
  }

  private log(level: string, msg: string): void {
    this.onLog?.(level, msg)
  }

  /** Execute one full run of the flow. Resolves with the final run state. */
  async run(flowName: string, runOptions?: FlowRunOptions): Promise<FlowRun> {
    const config = await this.flowStore.getConfig(flowName)
    const validation = validateFlow(config)
    if (!validation.valid) {
      throw new Error(`invalid flow "${flowName}": ${validation.errors.join('; ')}`)
    }

    const runId = randomUUID()
    const run: FlowRun = {
      id: runId,
      flowName,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodes: {},
      inputs: runOptions?.inputs,
    }
    for (const [name, node] of Object.entries(config.nodes)) {
      run.nodes[name] = { node: name, type: node.type, status: 'pending' }
    }
    await this.flowStore.saveRun(flowName, run)
    sentinelEvents.emit('flow:started', { name: flowName, runId })
    this.log('info', `Flow ${flowName} started (run ${runId.slice(0, 8)}, ${Object.keys(run.nodes).length} nodes)`)

    const concurrency = config.concurrency ?? this.concurrency
    const inflight = new Map<string, Promise<void>>()

    while (!this.allSettled(run)) {
      for (const name of this.readyNodes(config, run)) {
        if (inflight.size >= concurrency) break
        if (inflight.has(name)) continue

        run.nodes[name].status = 'running'
        run.nodes[name].startedAt = new Date().toISOString()
        sentinelEvents.emit('flow:node-status-changed', {
          name: flowName, runId, node: name, status: 'running',
        })

        const p = this.executeNode(flowName, config, run, name)
          .catch((err) => {
            // executeNode guards internally - this is a hard safety net
            const nr = run.nodes[name]
            if (nr.status !== 'success' && nr.status !== 'skipped') {
              nr.status = 'failed'
              nr.error = String(err)
              nr.finishedAt = new Date().toISOString()
            }
          })
          .finally(() => {
            inflight.delete(name)
          })
        inflight.set(name, p)
      }

      if (inflight.size === 0) {
        // Nothing runnable and nothing inflight: remaining nodes are
        // unreachable (shouldn't happen after validation, but a failed
        // node with onFailure 'stop' leaves exactly this state).
        this.skipUnreachable(config, run)
        break
      }

      await Promise.race(inflight.values())
      await this.flowStore.saveRun(flowName, run)
    }

    // Finalize flow status
    const nodeRuns = Object.values(run.nodes)
    const anyFailed = nodeRuns.some((n) => n.status === 'failed')
    const blocked = nodeRuns.some(
      (n) => n.status === 'skipped' && n.skipReason !== 'manual-gate',
    )
    run.status = !anyFailed ? 'success' : blocked ? 'failed' : 'partial'
    run.finishedAt = new Date().toISOString()
    await this.flowStore.saveRun(flowName, run)
    sentinelEvents.emit('flow:completed', {
      name: flowName, runId, success: run.status === 'success',
    })
    this.log(
      run.status === 'success' ? 'info' : 'warn',
      `Flow ${flowName} finished with status "${run.status}"`,
    )
    return run
  }

  private allSettled(run: FlowRun): boolean {
    return Object.values(run.nodes).every(
      (n) => n.status === 'success' || n.status === 'failed' || n.status === 'skipped',
    )
  }

  /** Nodes whose dependencies are all satisfied. A failed dependency
   *  only satisfies its dependents when it opted into onFailure 'continue'. */
  private readyNodes(config: FlowConfig, run: FlowRun): string[] {
    const ready: string[] = []
    for (const [name, node] of Object.entries(config.nodes)) {
      const nr = run.nodes[name]
      if (!nr || nr.status !== 'pending') continue
      const satisfied = (node.needs ?? []).every((dep) => {
        const depRun = run.nodes[dep]
        if (!depRun) return false
        if (depRun.status === 'success') return true
        return depRun.status === 'failed' && config.nodes[dep]?.onFailure === 'continue'
      })
      if (satisfied) ready.push(name)
    }
    return ready
  }

  /** Mark pending/running nodes that can never run as skipped. */
  private skipUnreachable(config: FlowConfig, run: FlowRun): void {
    for (const nr of Object.values(run.nodes)) {
      if (nr.status === 'pending' || nr.status === 'running') {
        const deps = config.nodes[nr.node]?.needs ?? []
        nr.skipReason = deps.some((d) => {
          const dr = run.nodes[d]
          return dr?.status === 'failed' || dr?.status === 'skipped'
        })
          ? 'upstream-failure'
          : 'unreachable'
        nr.status = 'skipped'
        nr.finishedAt = new Date().toISOString()
      }
    }
  }

  /** Execute a single node and update its run entry. Never throws. */
  private async executeNode(
    flowName: string,
    config: FlowConfig,
    run: FlowRun,
    name: string,
  ): Promise<void> {
    const node = config.nodes[name]
    const nr = run.nodes[name]
    try {
      if (node.type === 'manual' && !node.aiTakeover) {
        // Unattended manual gate without AI takeover - skip rather than
        // block the flow forever.
        nr.status = 'skipped'
        nr.skipReason = 'manual-gate'
        nr.finishedAt = new Date().toISOString()
        this.log('warn', `Node ${name} (manual) skipped - no aiTakeover configured`)
        return
      }

      let output: string
      if (node.type === 'script') {
        output = await this.runScriptNode(flowName, run, node)
      } else {
        // 'ai' nodes, plus 'manual' nodes with aiTakeover
        output = await this.runAiNode(flowName, config, run, name, node.type === 'ai' ? node : undefined)      }
      nr.status = 'success'
      nr.output = output.slice(-8000)
    } catch (err) {
      nr.status = 'failed'
      nr.error = String(err).slice(0, 2000)
      this.log('error', `Node ${name} failed: ${nr.error}`)
    }
    nr.finishedAt = new Date().toISOString()
    sentinelEvents.emit('flow:node-status-changed', {
      name: flowName, runId: run.id, node: name, status: nr.status,
    })
    await this.flowStore.saveRun(flowName, run)
  }

  /** Resolve {node.output} and {inputs.key} placeholders. Upstream
   *  outputs are trimmed so a trailing newline doesn't break the
   *  interpolated command/prompt; multi-line output quoting is the
   *  flow author's responsibility. */
  private resolveTemplate(template: string, run: FlowRun): string {
    return template
      .replace(/\{([\w-]+)\.output\}/g, (_m, nodeName: string) => run.nodes[nodeName]?.output?.trim() ?? '')
      .replace(/\{inputs\.([\w-]+)\}/g, (_m, key: string) => run.inputs?.[key] ?? '')
  }

  private async runScriptNode(
    flowName: string,
    run: FlowRun,
    node: ScriptFlowNode,
  ): Promise<string> {
    const { shell, flag } = resolveShell()
    const cwd = resolve(this.flowStore.getFlowDir(flowName), node.cwd ?? '.')
    const command = this.resolveTemplate(node.run, run)

    return new Promise((resolvePromise, reject) => {
      const proc = spawn(shell, [flag, command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: (node.timeout ?? 300) * 1000,
      })
      let stdout = ''
      let stderr = ''
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('close', (code) => {
        if (code === 0) resolvePromise(stdout)
        else {
          const hint = stderr.trim().slice(0, 500)
          reject(new Error(hint ? `script exited with code ${code}: ${hint}` : `script exited with code ${code}`))
        }
      })
      proc.on('error', reject)
    })
  }

  /**
   * Execute an ai node against its referenced task workspace, or a
   * manual node's AI takeover in the flow directory.
   */
  private async runAiNode(
    flowName: string,
    config: FlowConfig,
    run: FlowRun,
    name: string,
    aiNode: AIFlowNode | undefined,
  ): Promise<string> {
    const nr = run.nodes[name]
    let taskDir: string
    let baseConfig: TaskConfig

    if (aiNode) {
      // Throws if the referenced task doesn't exist - node fails with
      // a clear error.
      taskDir = this.taskStore.getTaskDir(aiNode.task)
      baseConfig = await this.taskStore.getConfig(aiNode.task)
    } else {
      // Manual node with aiTakeover: run in the flow directory
      const node = config.nodes[name] as ManualFlowNode
      taskDir = this.flowStore.getFlowDir(flowName)
      baseConfig = {
        name: `flow-${flowName}-${name}`,
        description: `AI takeover of manual node "${name}"`,
        version: 1,
        schedule: { type: 'once', expr: 'now' },
        execution: { prompt: node.takeoverPrompt ?? `Complete the manual step "${name}" of flow "${flowName}".` },
      }
      nr.aiTakeover = true
    }

    const prompt = this.resolveTemplate(aiNode?.promptTemplate ?? baseConfig.execution.prompt, run)
    const result = await executeTask({
      taskDir,
      config: {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          prompt,
          model: aiNode?.model ?? baseConfig.execution.model,
        },
      },
      opencodeBin: this.opencodeBin,
    })
    nr.taskRecordId = result.record.id

    if (result.record.status !== 'success') {
      throw new Error(result.record.error ?? `agent exited with code ${result.record.exitCode}`)
    }
    return result.stdout
  }
}
