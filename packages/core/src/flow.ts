import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { executeTask } from './executor.js'
import type { ExecutorOptions, ExecutionResult } from './executor.js'
import { resolveShell } from './verification.js'
import { FlowStore } from './flow-store.js'
import { TaskStore, isValidTaskName } from './task-store.js'
import { sentinelEvents } from './events.js'
import type {
  AIFlowNode,
  FlowConfig,
  FlowEdge,
  FlowEdgeCondition,
  FlowNodeRun,
  FlowRun,
  ManualFlowNode,
  ScriptFlowNode,
  TaskConfig,
} from './types.js'

// ─── Edge helpers ───────────────────────────────────────────

/** The upstream node name a needs entry points at. */
export function edgeTarget(need: string | FlowEdge): string {
  return typeof need === 'string' ? need : need.node
}

/** The condition under which a needs entry is satisfied. */
export function edgeCondition(need: string | FlowEdge): FlowEdgeCondition {
  return typeof need === 'string' ? 'success' : (need.on ?? 'success')
}

/** Cap a text block appended as AI context: keep head + tail so both the
 *  beginning and the end of long reports survive truncation. */
const CONTEXT_CLIP = 4000
function clipForContext(text: string): string {
  if (text.length <= CONTEXT_CLIP) return text
  const head = Math.floor(CONTEXT_CLIP * 0.4)
  const tail = CONTEXT_CLIP - head
  return `${text.slice(0, head)}\n…(truncated ${text.length - CONTEXT_CLIP} chars)…\n${text.slice(-tail)}`
}

// ─── Validation ─────────────────────────────────────────────

export interface FlowValidationResult {
  valid: boolean
  errors: string[]
}

export interface FlowValidationOptions {
  /** Draft mode (editor autosave): fill-in fields may still be empty -
   *  ai nodes without a task reference and script nodes without a run
   *  command are allowed to SAVE but remain un-runnable. Structural
   *  errors (names, dependency references, cycles) are still reported. */
  lenient?: boolean
}

/** Validate a flow config: node shape, dependency references, cycles. */
export function validateFlow(config: FlowConfig, options?: FlowValidationOptions): FlowValidationResult {
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
    if ((node.needs ?? []).some((need) => edgeTarget(need) === name)) {
      errors.push(`node "${name}" depends on itself`)
    }
    for (const need of node.needs ?? []) {
      if (!(edgeTarget(need) in nodes)) {
        errors.push(`node "${name}" needs unknown node "${edgeTarget(need)}"`)
      }
      if (typeof need === 'object' && need.on !== undefined &&
          !['success', 'failure', 'finished'].includes(need.on)) {
        errors.push(`node "${name}" has invalid edge condition "${String(need.on)}"`)
      }
    }
    if (node.type === 'ai' && !node.task && !node.promptTemplate && !options?.lenient) {
      errors.push(`ai node "${name}" requires a task reference or an inline prompt`)
    }
    if (node.type === 'script' && !node.run && !options?.lenient) {
      errors.push(`script node "${name}" requires a run command`)
    }
  }

  // Cycle detection (Kahn's algorithm)
  if (nodeNames.length > 0) {
    const dependents: Record<string, string[]> = {}
    const indegree: Record<string, number> = {}
    for (const n of nodeNames) {
      dependents[n] = []
      indegree[n] = new Set((nodes[n].needs ?? []).map(edgeTarget)).size
    }
    for (const [name, node] of Object.entries(nodes)) {
      for (const dep of new Set((node.needs ?? []).map(edgeTarget))) {
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
  /** Replace the CLI executor for AI nodes (desktop serve runtime). */
  executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
  onLog?: (level: string, msg: string) => void
}

export interface FlowRunOptions {
  /** Run inputs, referenced via {inputs.key} placeholders. */
  inputs?: Record<string, string>
  /** Resume a previous run: successful nodes' outputs are reused as-is
   *  and only the remaining nodes execute. */
  resumeFromRunId?: string
}

/** Human decision on a manual gate. */
export interface ManualGateDecision {
  approved: boolean
  /** Reviewer note; becomes the node output (injected downstream) when
   *  approved, or the failure reason when rejected. */
  note?: string
}

/** Internal gate settlement: either a human decision or an engine-side
 *  cancellation (budget guard) - the canceller has already settled the
 *  node record when it resolves with this. */
type GateSettlement = ManualGateDecision | { cancelled: 'budget-exhausted' }

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
  private executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
  private onLog?: (level: string, msg: string) => void
  /** Open manual gates: `${flowName}::${runId}::${node}` -> settle fn. */
  private manualGates = new Map<string, (s: GateSettlement) => void>()

  constructor(options: FlowEngineOptions) {
    this.flowStore = options.flowStore
    this.taskStore = options.taskStore
    this.opencodeBin = options.opencodeBin ?? 'opencode'
    this.concurrency = options.concurrency ?? 3
    this.executeOverride = options.executeOverride
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

    // ── Resume: reuse successful nodes from a previous run ──
    if (runOptions?.resumeFromRunId) {
      const runs = await this.flowStore.getRuns(flowName)
      const prev = runs.find((r) => r.id === runOptions.resumeFromRunId)
      if (!prev) {
        throw new Error(`resume: run ${runOptions.resumeFromRunId} not found for flow "${flowName}"`)
      }
      let resumed = 0
      for (const [name, nr] of Object.entries(prev.nodes)) {
        if (nr.status === 'success' && run.nodes[name]) {
          run.nodes[name] = { ...nr, finishedAt: nr.finishedAt ?? run.startedAt }
          resumed++
        }
      }
      run.resumedFrom = prev.id
      this.log('info', `Resuming from run ${prev.id.slice(0, 8)}: reusing ${resumed} successful node(s)`)
    }

    await this.flowStore.saveRun(flowName, run)
    sentinelEvents.emit('flow:started', { name: flowName, runId })
    this.log('info', `Flow ${flowName} started (run ${runId.slice(0, 8)}, ${Object.keys(run.nodes).length} nodes)`)

    const concurrency = config.concurrency ?? this.concurrency
    const maxTotalMs =
      config.maxTotalSeconds != null ? config.maxTotalSeconds * 1000 : null
    const runStartedAt = Date.now()
    const inflight = new Map<string, Promise<void>>()

    while (!this.allSettled(run)) {
      // ── Budget guard: stop launching new nodes once the wall-clock
      // budget is exhausted (in-flight nodes run to completion) ──
      if (maxTotalMs !== null && Date.now() - runStartedAt >= maxTotalMs) {
        this.log('warn', `Flow ${flowName} wall-clock budget of ${config.maxTotalSeconds}s exceeded, stopping`)
        for (const nr of Object.values(run.nodes)) {
          if (nr.status === 'pending') {
            nr.status = 'skipped'
            nr.skipReason = 'budget-exhausted'
            nr.finishedAt = new Date().toISOString()
          } else if (nr.status === 'waiting') {
            // Settle the node record here so the finalized run below sees
            // the skipped state; the gate's executeNode continuation then
            // returns without writing.
            nr.status = 'skipped'
            nr.skipReason = 'budget-exhausted'
            nr.finishedAt = new Date().toISOString()
            this.settleGate(flowName, run.id, nr.node, { cancelled: 'budget-exhausted' })
          }
        }
        await this.flowStore.saveRun(flowName, run)
        break
      }

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

    // Finalize flow status: 'success' = everything that should run did;
    // 'failed' = blocked (legacy failure propagation, budget exhaustion
    // or unreachable nodes); 'partial' = failures but all reachable
    // nodes completed (including conditional branches not taken).
    const nodeRuns = Object.values(run.nodes)
    const anyFailed = nodeRuns.some((n) => n.status === 'failed')
    const blocked = nodeRuns.some(
      (n) =>
        n.status === 'skipped' &&
        n.skipReason !== 'manual-gate' &&
        n.skipReason !== 'branch-not-taken',
    )
    run.status = blocked ? 'failed' : anyFailed ? 'partial' : 'success'
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

  /** Whether a single dependency edge is satisfied by the upstream's
   *  current state. Conditional edges ('failure'/'finished') branch on
   *  the upstream result; plain success edges additionally honor the
   *  legacy upstream onFailure: 'continue' policy. */
  private edgeSatisfied(config: FlowConfig, run: FlowRun, need: string | FlowEdge): boolean {
    const dep = edgeTarget(need)
    const on = edgeCondition(need)
    const depRun = run.nodes[dep]
    if (!depRun) return false
    if (depRun.status === 'success') return on === 'success' || on === 'finished'
    if (depRun.status === 'failed') {
      if (on === 'failure' || on === 'finished') return true
      return config.nodes[dep]?.onFailure === 'continue' && on === 'success'
    }
    return false
  }

  /** Nodes whose dependency edges are all satisfied. */
  private readyNodes(config: FlowConfig, run: FlowRun): string[] {
    const ready: string[] = []
    for (const [name, node] of Object.entries(config.nodes)) {
      const nr = run.nodes[name]
      if (!nr || nr.status !== 'pending') continue
      const satisfied = (node.needs ?? []).every((need) => this.edgeSatisfied(config, run, need))
      if (satisfied) ready.push(name)
    }
    return ready
  }

  /** Mark pending/running nodes that can never run as skipped.
   *  Plain-string edges to a failed upstream (legacy semantics) count as
   *  'upstream-failure' (flow blocked); explicit conditional edges that
   *  can no longer be met count as 'branch-not-taken' (by design). */
  private skipUnreachable(config: FlowConfig, run: FlowRun): void {
    for (const nr of Object.values(run.nodes)) {
      if (nr.status !== 'pending' && nr.status !== 'running') continue
      const needs = config.nodes[nr.node]?.needs ?? []
      let reason: FlowNodeRun['skipReason'] = 'unreachable'
      for (const need of needs) {
        const target = edgeTarget(need)
        const dr = run.nodes[target]
        if (!dr || (dr.status !== 'failed' && dr.status !== 'skipped')) continue
        if (typeof need === 'string' && config.nodes[target]?.onFailure !== 'continue') {
          reason = 'upstream-failure'
          break
        }
        if (typeof need === 'object') {
          reason = 'branch-not-taken'
          // keep scanning - a plain-string blocked edge takes precedence
        }
      }
      nr.skipReason = reason
      nr.status = 'skipped'
      nr.finishedAt = new Date().toISOString()
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
    let output: string
    try {
      if (node.type === 'manual' && !node.aiTakeover) {
        // Human gate: block this branch of the flow until someone
        // approves or rejects it (desktop shows an approval card).
        const settlement = await this.openManualGate(flowName, run, name, node)
        if ('cancelled' in settlement) {
          // Engine-side cancellation already settled the node record
          return
        }
        if (!settlement.approved) {
          throw new Error(settlement.note?.trim() || 'manual gate rejected')
        }
        output = settlement.note?.trim() || 'approved'
      } else {
        output = node.type === 'script'
          ? await this.runScriptNode(flowName, run, node)
          : await this.runAiNode(flowName, config, run, name, node.type === 'ai' ? node : undefined)
      }
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

  /** Register a manual gate and resolve once a human decides (or the
   *  engine cancels it). The node enters 'waiting' and the run is
   *  persisted before the promise suspends. */
  private openManualGate(
    flowName: string,
    run: FlowRun,
    name: string,
    node: ManualFlowNode,
  ): Promise<GateSettlement> {
    return new Promise<GateSettlement>((resolveGate) => {
      this.manualGates.set(`${flowName}::${run.id}::${name}`, resolveGate)

      const nr = run.nodes[name]
      nr.status = 'waiting'
      nr.waitingSince = new Date().toISOString()
      sentinelEvents.emit('flow:node-status-changed', {
        name: flowName, runId: run.id, node: name, status: 'waiting',
      })
      sentinelEvents.emit('flow:manual-gate', {
        name: flowName, runId: run.id, node: name, message: node.gatePrompt,
      })
      this.log('info', `Node ${name} (manual) waiting for human decision`)
      void this.flowStore.saveRun(flowName, run)
    })
  }

  /** Resolve (or drop) a gate entry; no-op when already settled. */
  private settleGate(
    flowName: string,
    runId: string,
    node: string,
    settlement: GateSettlement,
  ): boolean {
    const key = `${flowName}::${runId}::${node}`
    const settle = this.manualGates.get(key)
    if (!settle) return false
    this.manualGates.delete(key)
    settle(settlement)
    return true
  }

  /** Resolve a waiting manual gate with a human decision (approve /
   *  reject, optional note). Returns false when no live gate matches
   *  (unknown node, run already settled or cancelled). */
  resolveManualNode(
    flowName: string,
    runId: string,
    node: string,
    decision: ManualGateDecision,
  ): boolean {
    return this.settleGate(flowName, runId, node, decision)
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

  /** Compose the automatic upstream context block for an AI execution:
   *  every direct dependency's result - the output on success, or the
   *  error when a failed upstream was reached via a failure/finished
   *  edge (or onFailure: continue). Returns null when there is nothing
   *  to inject (no needs, or no dependency produced content). */
  private buildUpstreamContext(config: FlowConfig, run: FlowRun, name: string): string | null {
    const needs = config.nodes[name]?.needs ?? []
    if (needs.length === 0) return null
    const sections: string[] = []
    for (const need of needs) {
      const dep = edgeTarget(need)
      const nr = run.nodes[dep]
      if (!nr) continue
      let body: string | undefined
      if (nr.status === 'success') {
        body = nr.output?.trim()
      } else if (nr.status === 'failed') {
        body = nr.error?.trim() ? `error: ${nr.error!.trim()}` : undefined
      }
      if (!body) continue
      sections.push(`<upstream node="${dep}" status="${nr.status}">\n${clipForContext(body)}\n</upstream>`)
    }
    if (sections.length === 0) return null
    return `<upstream_results>\n${sections.join('\n')}\n</upstream_results>`
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
   * Execute an ai node: in the referenced task's workspace (reference
   * mode), inline in the flow directory (ai node without task), or a
   * manual node's AI takeover (also flow directory).
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

    if (aiNode?.task) {
      // Reference mode - throws if the referenced task doesn't exist,
      // the node fails with a clear error.
      taskDir = this.taskStore.getTaskDir(aiNode.task)
      baseConfig = await this.taskStore.getConfig(aiNode.task)
    } else {
      // Inline definition in the flow directory: an ai node without a
      // task reference, or a manual node's aiTakeover. Flow-level
      // .opencode/skills are available to the agent.
      const fallbackPrompt = aiNode
        ? `Execute inline step "${name}" of flow "${flowName}".`
        : (config.nodes[name] as ManualFlowNode).takeoverPrompt ??
          `Complete the manual step "${name}" of flow "${flowName}".`
      taskDir = this.flowStore.getFlowDir(flowName)
      baseConfig = {
        name: `flow-${flowName}-${name}`,
        description: `Inline execution of node "${name}" (flow "${flowName}")`,
        version: 1,
        schedule: { type: 'once', expr: 'now' },
        execution: { prompt: aiNode?.promptTemplate ?? fallbackPrompt },
      }
      if (!aiNode) nr.aiTakeover = true
    }

    let prompt = this.resolveTemplate(aiNode?.promptTemplate ?? baseConfig.execution.prompt, run)
    // Automatic upstream context: dependencies' results ride along even
    // when the prompt template doesn't reference them via {node.output}.
    if (config.nodes[name]?.injectUpstream !== false) {
      const context = this.buildUpstreamContext(config, run, name)
      if (context) {
        prompt = `${prompt}\n\nThe following are the results of the upstream nodes this step depends on (use them as context):\n${context}`
      }
    }
    const result = await (this.executeOverride ?? executeTask)({
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
    // Clean digest (assistant text + tool trace) - downstream prompt
    // templates should not receive the raw JSON event blob.
    return result.summary
  }
}
