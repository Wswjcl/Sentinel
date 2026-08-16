export interface TaskSchedule {
  type: 'cron' | 'interval' | 'once'
  expr: string
  timezone?: string
}

export interface TaskExecution {
  prompt: string
  model?: string
  agent?: string
  skills?: string[]
  timeout?: number
  retry?: {
    max: number
    delay: number
  }
  /** Prompt template for fix iterations in Agent Loop.
   *  Placeholders: {originalPrompt} = the original task prompt,
   *  {verification} = verification feedback, {output} = last output snippet */
  fixPromptTemplate?: string
}

// ─── Loop Engineering ───────────────────────────────────────

/** Verification configuration for Agent Loop.
 *  Two modes: 'command' (shell check, zero cost) or 'llm' (semantic check, higher quality). */
export interface LoopVerification {
  type: 'command' | 'llm'
  /** Shell command for 'command' mode. Exit code 0 = pass.
   *  Runs inside the task directory. e.g. "test -f output/result.md" */
  command?: string
  /** Verification criteria text for 'llm' mode.
   *  e.g. "输出是否包含关键信息；格式是否为 Markdown" */
  criteria?: string
  /** Skill name for 'llm' mode. If omitted, criteria is sent as the prompt directly. */
  skill?: string
  /** What to do when verification fails */
  onFailure: 'iterate' | 'notify' | 'stop'
}

/** Agent Loop configuration — the core of Loop Engineering.
 *  When enabled, the scheduler runs: execute → verify → fix → iterate (up to maxIterations). */
export interface AgentLoopConfig {
  enabled: boolean
  /** Maximum iteration rounds (default 3). First execution = iteration 0. */
  maxIterations?: number
  /** Wall-clock budget for the whole loop in seconds. When exceeded, no
   *  further iterations start and the loop ends as failed. */
  maxTotalSeconds?: number
  verification: LoopVerification
}

export interface TaskNotify {
  on_success?: 'webhook' | 'none'
  on_failure?: 'webhook' | 'none'
  webhook_url?: string
}

export interface TaskConfig {
  name: string
  description: string
  version: number
  schedule: TaskSchedule
  execution: TaskExecution
  notify?: TaskNotify
  /** Loop Engineering: enable Agent Loop for this task */
  agentLoop?: AgentLoopConfig
}

export type TaskStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'
  | 'archived'

export interface TaskRunRecord {
  id: string
  taskName: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'failed'
  exitCode?: number
  error?: string
  output?: string
  /** Agent Loop: which iteration round (0 = first execution) */
  iteration?: number
  /** Agent Loop: whether verification passed for this iteration */
  verificationPassed?: boolean
  /** Agent Loop: verification result message / error details */
  verificationOutput?: string
}

export interface TaskInfo {
  config: TaskConfig
  dir: string
  status: TaskStatus
  lastRun?: string
  nextRun?: string
  runCount: number
  history: TaskRunRecord[]
}

// ─── Flow Engineering ───────────────────────────────────────

export type FlowNodeType = 'ai' | 'script' | 'manual'

export interface FlowNodeBase {
  /** Node type: 'ai' (OpenCode task), 'script' (shell command),
   *  'manual' (human gate, optionally taken over by the AI). */
  type: FlowNodeType
  /** Upstream node names - DAG edges. Nodes without dependency
   *  relations run in parallel automatically. */
  needs?: string[]
  /** Failure policy: 'stop' (default, downstream nodes are skipped)
   *  or 'continue' (downstream nodes still run). */
  onFailure?: 'stop' | 'continue'
}

export interface AIFlowNode extends FlowNodeBase {
  type: 'ai'
  /** Name of an existing task workspace this node executes. */
  task: string
  /** Prompt template. Placeholders {node.output} inject upstream node
   *  outputs and {inputs.key} injects run inputs. Falls back to the
   *  referenced task's own prompt when omitted. */
  promptTemplate?: string
  /** Model override for this node. */
  model?: string
}

export interface ScriptFlowNode extends FlowNodeBase {
  type: 'script'
  /** Shell command to run inside the flow directory. Supports the same
   *  {node.output} / {inputs.key} placeholders (raw injection - quoting
   *  is the author's responsibility). */
  run: string
  /** Working directory relative to the flow directory (default '.'). */
  cwd?: string
  /** Timeout in seconds (default 300). */
  timeout?: number
}

export interface ManualFlowNode extends FlowNodeBase {
  type: 'manual'
  /** Allow the AI agent to take over this manual step unattended. */
  aiTakeover?: boolean
  /** Prompt used when the AI takes over (runs in the flow directory). */
  takeoverPrompt?: string
}

export type FlowNode = AIFlowNode | ScriptFlowNode | ManualFlowNode

export interface FlowConfig {
  name: string
  description?: string
  version: number
  /** Whole-flow schedule. When set, the scheduler triggers the flow. */
  schedule?: TaskSchedule
  /** Max nodes running in parallel (default: engine concurrency). */
  concurrency?: number
  nodes: Record<string, FlowNode>
}

export type FlowNodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface FlowNodeRun {
  node: string
  type: FlowNodeType
  status: FlowNodeStatus
  startedAt?: string
  finishedAt?: string
  /** Output passed to downstream nodes (truncated stdout). */
  output?: string
  error?: string
  /** Why a skipped node was skipped. */
  skipReason?: 'upstream-failure' | 'manual-gate' | 'unreachable'
  /** For ai nodes: the id of the task run record produced. */
  taskRecordId?: string
  /** Whether the AI took over a manual node. */
  aiTakeover?: boolean
}

export interface FlowRun {
  id: string
  flowName: string
  status: 'running' | 'success' | 'failed' | 'partial'
  startedAt: string
  finishedAt?: string
  nodes: Record<string, FlowNodeRun>
  /** Inputs injected at run start ({inputs.key} placeholders). */
  inputs?: Record<string, string>
}
