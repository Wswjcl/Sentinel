import type {
  TaskConfig, TaskInfo, TaskRunRecord, TaskStatus, AgentLoopConfig,
  FlowConfig, FlowRun, FlowNodeStatus,
} from '@sentinel/core'

// ─── IPC Channel Names (single source of truth) ────────────────────

export const IPC = {
  // Tasks
  TASKS_LIST: 'tasks:list',
  TASKS_GET: 'tasks:get',
  TASKS_CREATE: 'tasks:create',
  TASKS_DELETE: 'tasks:delete',
  TASKS_RUN: 'tasks:run',
  TASKS_PAUSE: 'tasks:pause',
  TASKS_RESUME: 'tasks:resume',
  TASKS_UPDATE: 'tasks:update',
  TASKS_HISTORY: 'tasks:history',
  TASKS_WORKSPACE: 'tasks:workspace',
  TASKS_SKILLS: 'tasks:skills',
  TASKS_OUTPUTS: 'tasks:outputs',
  TASKS_READ_OUTPUT: 'tasks:read-output',
  TASKS_SCRIPTS: 'tasks:scripts',

  // OpenCode config
  TASKS_OPENCODE_GET: 'tasks:opencode:get',
  TASKS_OPENCODE_UPDATE: 'tasks:opencode:update',

  // Flows
  FLOWS_LIST: 'flows:list',
  FLOWS_GET: 'flows:get',
  FLOWS_SAVE: 'flows:save',
  FLOWS_DELETE: 'flows:delete',
  FLOWS_RUN: 'flows:run',
  FLOWS_VALIDATE: 'flows:validate',

  // Scheduler
  SCHEDULER_START: 'scheduler:start',
  SCHEDULER_STOP: 'scheduler:stop',
  SCHEDULER_STATUS: 'scheduler:status',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // App
  APP_VERSION: 'app:version',

  // Real-time events (main → renderer)
  EVENT_TASK_UPDATE: 'event:task-update',
  EVENT_SCHEDULER_LOG: 'event:scheduler-log',
  EVENT_SCHEDULER_STATUS: 'event:scheduler-status',
  EVENT_LOOP_UPDATE: 'event:loop-update',
  EVENT_FLOW_UPDATE: 'event:flow-update',
} as const

// ─── Request / Response Types ──────────────────────────────────────

export interface CreateTaskOpts {
  name: string
  description?: string
  projectDir?: string
  schedule?: { type?: string; expr?: string; timezone?: string }
  execution?: {
    prompt?: string
    model?: string
    agent?: string
    timeout?: number
    retry?: { max?: number; delay?: number }
    skills?: string[]
  }
  skills?: string[]
  externalDirs?: Array<{
    path: string
    permission: 'allow' | 'deny'
    read?: boolean
    write?: boolean
    exec?: boolean
  }>
  allowTools?: string[]
  denyTools?: string[]
  /** Loop Engineering: agent loop config for this task */
  agentLoop?: AgentLoopConfig
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface OutputFile {
  name: string
  size: number
  mtime: string
}

export interface SkillInfo {
  name: string
  content: string | null
}

// ─── Agent Loop real-time events (main -> renderer) ────────────────

export type LoopEventData =
  | { event: 'iteration-started'; name: string; iteration: number }
  | { event: 'iteration-completed'; name: string; iteration: number; passed: boolean }
  | { event: 'verification-failed'; name: string; iteration: number; verification: { passed: boolean; message: string } }
  | { event: 'completed'; name: string; success: boolean; iterations: number }

// ─── Flow data types ────────────────────────────────────────────────

export interface FlowInfo {
  config: FlowConfig
  dir: string
  runs: FlowRun[]
}

export type FlowEventData =
  | { event: 'started'; name: string; runId: string }
  | { event: 'node-status-changed'; name: string; runId: string; node: string; status: FlowNodeStatus }
  | { event: 'completed'; name: string; runId: string; success: boolean }

// ─── Exposed API (preload → renderer) ──────────────────────────────

export interface ExposedAPI {
  // Tasks — request/response
  getTasks(): Promise<TaskInfo[]>
  getTask(name: string): Promise<TaskInfo>
  createTask(opts: CreateTaskOpts): Promise<{ ok: boolean; name: string; dir: string }>
  deleteTask(name: string): Promise<{ ok: boolean }>
  runTask(name: string): Promise<{ ok: boolean; status: string }>
  pauseTask(name: string): Promise<{ ok: boolean }>
  resumeTask(name: string): Promise<{ ok: boolean }>
  updateTask(name: string, opts: Partial<CreateTaskOpts>): Promise<{ ok: boolean }>
  getTaskHistory(name: string): Promise<TaskRunRecord[]>
  getTaskWorkspace(name: string): Promise<{ dir: string; tree: TreeNode[] }>
  getTaskSkills(name: string): Promise<SkillInfo[]>
  getTaskOutputs(name: string): Promise<OutputFile[]>
  readTaskOutput(name: string, filename: string): Promise<string>
  getTaskScripts(name: string): Promise<string[]>

  // OpenCode config
  getOpenCodeConfig(name: string): Promise<Record<string, unknown>>
  updateOpenCodeConfig(name: string, config: Record<string, unknown>): Promise<{ ok: boolean }>

  // Flows
  getFlows(): Promise<FlowInfo[]>
  getFlow(name: string): Promise<FlowInfo>
  saveFlow(name: string, config: FlowConfig): Promise<{ ok: boolean }>
  deleteFlow(name: string): Promise<{ ok: boolean }>
  runFlow(name: string, inputs?: Record<string, string>): Promise<{ ok: boolean }>
  validateFlowConfig(config: FlowConfig): Promise<{ valid: boolean; errors: string[] }>

  // Scheduler
  startScheduler(): Promise<{ ok: boolean }>
  stopScheduler(): Promise<{ ok: boolean }>
  getSchedulerStatus(): Promise<{ running: boolean }>

  // Window controls
  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void

  // App
  getAppVersion(): Promise<string>

  // Real-time events (return cleanup function)
  onTaskUpdate(callback: (data: { name: string; status: TaskStatus }) => void): () => void
  onSchedulerLog(callback: (data: { level: string; msg: string; ts?: number }) => void): () => void
  onSchedulerStatus(callback: (data: { running: boolean }) => void): () => void
  onLoopUpdate(callback: (data: LoopEventData) => void): () => void
  onFlowUpdate(callback: (data: FlowEventData) => void): () => void
}
