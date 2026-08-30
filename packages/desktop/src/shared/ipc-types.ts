import type {
  TaskConfig, TaskInfo, TaskRunRecord, TaskStatus, AgentLoopConfig,
  FlowConfig, FlowRun, FlowNodeStatus, ManualGateDecision,
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
  FLOWS_CLONE: 'flows:clone',
  FLOWS_EXPORT: 'flows:export',
  FLOWS_IMPORT: 'flows:import',
  FLOW_MANUAL_RESOLVE: 'flows:manual-resolve',

  // Skills library (workspaces: tasks and flows)
  SKILLS_LIST_ALL: 'skills:list-all',
  SKILLS_SAVE: 'skills:save',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_COPY: 'skills:copy',
  SKILLS_EXPORT: 'skills:export',
  SKILLS_IMPORT: 'skills:import',

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
  APP_DATA: 'app:data',
  APP_RESTART: 'app:restart',

  // Tasks directory relocation
  TASKS_DIR_INFO: 'tasks:dir:info',
  TASKS_DIR_CHOOSE: 'tasks:dir:choose',
  TASKS_DIR_SET: 'tasks:dir:set',

  // Provider profiles (cc-switch-style, task-level bindings)
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_SAVE: 'providers:save',
  PROVIDERS_DELETE: 'providers:delete',
  TASK_BIND_PROVIDER: 'tasks:bind-provider',
  PROVIDERS_FETCH_MODELS: 'providers:fetch-models',

  // Model discovery (local `opencode models` output)
  MODELS_LIST: 'models:list',

  // Serve runtime (R3)
  RUNTIME_MODE_GET: 'runtime:mode:get',
  RUNTIME_MODE_SET: 'runtime:mode:set',
  TASK_PERMISSION_RESPOND: 'task:permission-respond',
  TASK_ABORT: 'task:abort',

  // Real-time events (main -> renderer)
  EVENT_TASK_UPDATE: 'event:task-update',
  EVENT_SCHEDULER_LOG: 'event:scheduler-log',
  EVENT_SCHEDULER_STATUS: 'event:scheduler-status',
  EVENT_LOOP_UPDATE: 'event:loop-update',
  EVENT_FLOW_UPDATE: 'event:flow-update',
  EVENT_TASK_LIVE: 'event:task-live',
  EVENT_TASK_PERMISSION: 'event:task-permission',
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
    session?: 'fresh' | 'continue' | 'fork'
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
  /** A manual gate opened - the UI shows an approve/reject card. */
  | { event: 'manual-gate'; name: string; runId: string; node: string; message?: string }
  | { event: 'completed'; name: string; runId: string; success: boolean }

// ─── Skills library data types ──────────────────────────────────────

/** Which kind of workspace a skill lives in. */
export type SkillWorkspaceKind = 'task' | 'flow'

/** Reference to a workspace that can hold skills. */
export interface SkillWorkspaceRef {
  kind: SkillWorkspaceKind
  workspace: string
}

/** One skill found in a workspace's .opencode/skills directory. */
export interface SkillEntry extends SkillWorkspaceRef {
  name: string
  /** SKILL.md content (null when the file is missing). */
  content: string | null
  /** Supporting files beside SKILL.md (scripts, references...). */
  extraFiles: number
}

// ─── Serve runtime (R3) ─────────────────────────────────────────────

export type RuntimeMode = 'cli' | 'serve'

export interface PermissionAskData {
  id: string
  sessionId: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

export type LiveEventData =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-start'; tool: string; title?: string }
  | { kind: 'tool-finish'; tool: string; title?: string; status: string }
  | { kind: 'status'; status: string }

// ─── Tasks directory relocation ─────────────────────────────────────

export interface TasksDirInfo {
  /** Effective tasks directory (override or default). */
  current: string
  /** Built-in location next to the program data. */
  defaultDir: string
  /** A user override is active. */
  overridden: boolean
}

// ─── Provider profiles (cc-switch-style, task-level bindings) ──────

/** A named endpoint+key+model combo. Compiled into the bound task
 *  workspace's .opencode config so the task overrides the global
 *  provider; secrets never leave the local file. */
export interface ProviderProfile {
  id: string
  name: string
  /** OpenCode provider id (e.g. "zai-coding-plan"). */
  provider: string
  /** Model id within the provider (e.g. "glm-5.2"). */
  model: string
  baseUrl?: string
  apiKey?: string
}

// ─── Exposed API (preload -> renderer) ──────────────────────────────

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
  runFlow(name: string, inputs?: Record<string, string>, resumeRunId?: string): Promise<{ ok: boolean }>
  cloneFlow(name: string, newName?: string): Promise<{ ok: boolean; name: string }>
  validateFlowConfig(config: FlowConfig): Promise<{ valid: boolean; errors: string[] }>
  /** Save a flow definition to a YAML file (native save dialog). */
  exportFlow(name: string): Promise<{ ok: boolean; path?: string }>
  /** Import a flow definition from a YAML/JSON file (native open dialog,
   *  auto-renames on name collision). Returns the stored flow name. */
  importFlow(): Promise<{ ok: boolean; name?: string }>
  /** Approve/reject a waiting manual gate. */
  resolveManualGate(
    name: string,
    runId: string,
    node: string,
    decision: ManualGateDecision,
  ): Promise<{ ok: boolean }>

  // Skills library
  listAllSkills(): Promise<SkillEntry[]>
  /** Create or update a skill's SKILL.md in a workspace. */
  saveSkill(ref: SkillWorkspaceRef, name: string, content: string): Promise<{ ok: boolean }>
  /** Remove a skill directory from a workspace. */
  deleteSkill(ref: SkillWorkspaceRef, name: string): Promise<{ ok: boolean }>
  /** Copy a whole skill directory (incl. supporting files) to another
   *  workspace. Fails when the target already has a skill by that name. */
  copySkill(from: SkillWorkspaceRef & { name: string }, to: SkillWorkspaceRef): Promise<{ ok: boolean }>
  /** Export a skill's SKILL.md via the native save dialog. */
  exportSkill(ref: SkillWorkspaceRef, name: string): Promise<{ ok: boolean; path?: string }>
  /** Import a skill from a .md file into a workspace (skill name =
   *  filename stem). Fails when the workspace already has that skill. */
  importSkill(to: SkillWorkspaceRef): Promise<{ ok: boolean; name?: string }>

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
  getAppDataDir(): Promise<string>
  restartApp(): Promise<void>

  // Tasks directory relocation
  getTasksDirInfo(): Promise<TasksDirInfo>
  /** Open a native directory picker; null when cancelled. */
  chooseTasksDir(): Promise<string | null>
  /** Switch the tasks directory. migrate=true moves workspaces living
   *  inside the current tasks dir into the new one. */
  setTasksDir(dir: string, migrate: boolean): Promise<{ ok: boolean; moved: number }>

  // Provider profiles
  listProviders(): Promise<ProviderProfile[]>
  /** Upsert by id (id generated from the name when absent). */
  saveProvider(profile: ProviderProfile): Promise<{ ok: boolean; profile: ProviderProfile }>
  deleteProvider(id: string): Promise<{ ok: boolean }>
  /** Bind/unbind a profile on a task (null unbinds). Compiles the
   *  profile into the task workspace's .opencode config. */
  bindTaskProvider(name: string, profileId: string | null): Promise<{ ok: boolean }>
  /** Discover model ids on an OpenAI-compatible endpoint (GET /models). */
  fetchProviderModels(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; models: string[] }>
  /** Models the local opencode actually supports (`opencode models`,
   *  cached ~5 min). Includes OpenCode Zen free models and every
   *  authenticated provider. */
  getModelList(): Promise<{ ok: boolean; models: string[] }>

  // Serve runtime
  getRuntimeMode(): Promise<RuntimeMode>
  setRuntimeMode(mode: RuntimeMode): Promise<{ ok: boolean }>
  respondTaskPermission(permissionId: string, response: 'once' | 'always' | 'reject'): Promise<{ ok: boolean }>
  abortTask(name: string): Promise<{ ok: boolean }>

  // Real-time events (return cleanup function)
  onTaskUpdate(callback: (data: { name: string; status: TaskStatus }) => void): () => void
  onSchedulerLog(callback: (data: { level: string; msg: string; ts?: number }) => void): () => void
  onSchedulerStatus(callback: (data: { running: boolean }) => void): () => void
  onLoopUpdate(callback: (data: LoopEventData) => void): () => void
  onFlowUpdate(callback: (data: FlowEventData) => void): () => void
  onTaskLiveEvent(callback: (data: { name: string; event: LiveEventData }) => void): () => void
  onTaskPermission(callback: (data: { name: string; request: PermissionAskData }) => void): () => void
}
