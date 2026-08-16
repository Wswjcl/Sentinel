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
