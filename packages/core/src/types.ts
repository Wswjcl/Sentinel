export interface TaskSchedule {
  type: 'cron' | 'interval' | 'once' | 'at'
  expr: string
  timezone?: string
  /** For type 'at' (v3.6.0): repeat cadence after the start time
   *  (interval expression like "30m" / "2h" / "1d"). Omit for a single run. */
  interval?: string
  /** For type 'at': cap on total runs; the task auto-archives when
   *  reached. Omit for unlimited. */
  maxRuns?: number
}

export interface TaskExecution {
  prompt: string
  model?: string
  agent?: string
  skills?: string[]
  timeout?: number
  /** Session continuity across runs (R2):
   *  - 'fresh' (default): every run starts a brand-new session
   *  - 'continue': resume the last run's session (--session), the agent
   *    sees the full conversation history and appends to it
   *  - 'fork': branch off the last run's session (--session --fork),
   *    history is inherited but the original session stays untouched */
  session?: 'fresh' | 'continue' | 'fork'
  /** Provider binding (v3.5.0): id of a desktop-managed provider profile.
   *  The profile's endpoint/key/model are compiled into the task
   *  workspace's .opencode/opencode.json (field-level merge) so this task
   *  overrides the global provider (e.g. the cc-switch-managed one).
   *  Tasks without a binding use the global config as before. */
  providerProfile?: string
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
  /** Permission card (v3.6.0): compiled into the workspace .opencode
   *  config by applyPermissionProfile. Absent = no Sentinel-managed
   *  permission rules (opencode defaults / user's own config). */
  permissions?: PermissionProfile
  /** Monthly budget cap: when month-to-date usage reaches either limit,
   *  further runs of this task are skipped (with a webhook notice). */
  budget?: TaskBudget
}

export interface TaskBudget {
  /** Max month-to-date cost in USD (opencode-reported). */
  monthlyCostUsd?: number
  /** Max month-to-date total tokens. */
  monthlyTokens?: number
}

/** Sentinel-managed permission card, compiled into the workspace
 *  .opencode config's permission section. */
/** One permission ask and its outcome ('timeout' = auto-denied after
 *  the 2-minute wait with no user answer). */
export interface PermissionAskRecord {
  permission: string
  patterns: string[]
  response: 'once' | 'always' | 'reject' | 'timeout'
  at: string
}

export type PermissionLevel = 'allow' | 'ask' | 'deny'
export type PermissionPreset = 'readonly' | 'standard' | 'trusted' | 'custom'
export interface PermissionProfile {
  preset: PermissionPreset
  /** Writable path globs relative to the project dir (custom preset only,
   *  e.g. "src/**", "docs/*.md"). Empty list = nothing writable without ask. */
  editGlobs?: string[]
  /** Bash policy (custom preset only; readonly forces ask, trusted allows). */
  bash?: PermissionLevel
  /** Bash command patterns that are always denied (custom preset only). */
  bashDeny?: string[]
  /** Access to paths outside the workspace - gates reads too. */
  external?: PermissionLevel
  webfetch?: PermissionLevel
}

export type TaskStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'
  | 'archived'

export interface ToolCallRecord {
  tool: string
  title?: string
  status: string
  input?: unknown
  output?: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface TaskRunRecord {
  id: string
  taskName: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'failed'
  exitCode?: number
  error?: string
  output?: string
  /** OpenCode session id (parsed from the JSON event stream) - enables
   *  session continuity via --session on later runs */
  sessionId?: string
  /** Token usage summed across all agent steps */
  tokens?: TokenUsage
  /** Cost in USD summed across all agent steps */
  cost?: number
  /** Permission asks raised during this run and how each was answered */
  permissionAsks?: PermissionAskRecord[]
  /** Number of agent steps (LLM round-trips) */
  steps?: number
  /** Structured tool-call audit, in execution order (bounded) */
  toolCalls?: ToolCallRecord[]
  /** Agent Loop: which iteration round (0 = first execution) */
  iteration?: number
  /** Agent Loop: whether verification passed for this iteration */
  verificationPassed?: boolean
  /** Agent Loop: verification result message / error details */
  verificationOutput?: string
  /** Provider provenance (v3.5.0): which provider/model actually served
   *  this run. `providerSource` says which config layer defined it -
   *  'workspace' (task .opencode config or an explicit model override)
   *  or 'global' (e.g. a cc-switch-managed global config). */
  provider?: string
  modelUsed?: string
  endpoint?: string
  providerSource?: 'workspace' | 'global'
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

export type FlowEdgeCondition = 'success' | 'failure' | 'finished'

/** A dependency edge. Plain strings in `needs` remain supported and are
 *  equivalent to { node, on: 'success' }. */
export interface FlowEdge {
  node: string
  /** When the downstream node may run based on this upstream's result:
   *  'success' (default), 'failure' (compensation branch), or
   *  'finished' (regardless of outcome). */
  on?: FlowEdgeCondition
}

export interface FlowNodeBase {
  /** Node type: 'ai' (OpenCode task), 'script' (shell command),
   *  'manual' (human gate, optionally taken over by the AI). */
  type: FlowNodeType
  /** Upstream edges - DAG dependencies. Nodes without dependency
   *  relations run in parallel automatically. */
  needs?: (string | FlowEdge)[]
  /** Failure policy: 'stop' (default, downstream nodes are skipped)
   *  or 'continue' (downstream nodes still run). Superseded by
   *  conditional edges ({ node, on: ... }) but kept for compatibility. */
  onFailure?: 'stop' | 'continue'
  /** AI execution only (ai nodes + manual aiTakeover): automatically append
   *  the direct upstream dependencies' results to the prompt as context,
   *  so downstream agents always see what their inputs produced - even
   *  without explicit {node.output} placeholders in the prompt template.
   *  Default true. */
  injectUpstream?: boolean
  /** Optional canvas position (persisted layout; auto-layout when absent). */
  position?: { x: number; y: number }
}

export interface AIFlowNode extends FlowNodeBase {
  type: 'ai'
  /** Reference mode: name of an existing task workspace this node
   *  executes in (its .opencode config and skills apply). Omit for an
   *  inline node: promptTemplate is the task definition and the node
   *  runs in the flow directory (flow-level .opencode/skills apply). */
  task?: string
  /** Prompt template. Placeholders {node.output} inject upstream node
   *  outputs and {inputs.key} injects run inputs. Falls back to the
   *  referenced task's own prompt when omitted; required for inline
   *  nodes (no task). */
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
  /** Instructions shown to the human when the gate opens (what to check
   *  before approving). */
  gatePrompt?: string
}

export type FlowNode = AIFlowNode | ScriptFlowNode | ManualFlowNode

export interface FlowConfig {
  name: string
  description?: string
  version: number
  /** Permission card (v3.6.0): compiled into the flow dir's .opencode
   *  config; governs inline AI nodes and manual-node AI takeover. */
  permissions?: PermissionProfile
  /** Whole-flow schedule. When set, the scheduler triggers the flow. */
  schedule?: TaskSchedule
  /** Max nodes running in parallel (default: engine concurrency). */
  concurrency?: number
  /** Wall-clock budget for the whole flow in seconds. When exceeded, no
   *  further nodes start and remaining nodes are skipped. */
  maxTotalSeconds?: number
  nodes: Record<string, FlowNode>
}

/** Node lifecycle: pending -> running -> success/failed/skipped.
 *  'waiting' is the extra manual-gate state: the node has started but is
 *  blocked on a human decision (approve/reject) before it settles. */
export type FlowNodeStatus = 'pending' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped'

export interface FlowNodeRun {
  node: string
  type: FlowNodeType
  status: FlowNodeStatus
  startedAt?: string
  /** When a manual gate entered 'waiting' (approval pending). */
  waitingSince?: string
  finishedAt?: string
  /** Output passed to downstream nodes (truncated stdout). */
  output?: string
  error?: string
  /** Why a skipped node was skipped. */
  skipReason?: 'upstream-failure' | 'branch-not-taken' | 'manual-gate' | 'unreachable' | 'budget-exhausted'
  /** For ai nodes: the id of the task run record produced. */
  taskRecordId?: string
  /** Whether the AI took over a manual node. */
  aiTakeover?: boolean
  /** Provider provenance (v3.5.0) - copied from the task run record. */
  provider?: string
  modelUsed?: string
  endpoint?: string
  providerSource?: 'workspace' | 'global'
  /** Token usage of the AI step, copied from the task run record. */
  tokens?: TokenUsage
  /** Cost in USD of the AI step, copied from the task run record. */
  cost?: number
  /** Permission asks raised during the AI step, copied from the record. */
  permissionAsks?: PermissionAskRecord[]
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
  /** The run this run resumed from (successful nodes' outputs reused). */
  resumedFrom?: string
}
