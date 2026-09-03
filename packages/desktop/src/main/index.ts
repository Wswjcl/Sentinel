import { app, BrowserWindow, ipcMain, Menu, shell, Tray, nativeImage, Notification, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, basename, parse } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { TaskStore, FlowStore, FlowEngine, Scheduler, runTaskExecution, executeTask, OpenCodeServer, validateFlow, isValidCron, isValidSchedule, isValidTaskName, generateOpenCodeConfig, generateSkillContent, sentinelEvents, applyProviderBinding, resolveWindowsBinary, applyPermissionProfile, hasPermissionProfile } from '@sentinel/core'
import type { TaskConfig, ExternalDir, OpenCodeConfig, FlowConfig, PermissionResponse, ExecutorOptions, ExecutionResult, ManualGateDecision, PermissionProfile } from '@sentinel/core'
import { IPC } from '../shared/ipc-types'
import type { CreateTaskOpts, TreeNode, OutputFile, SkillInfo, LoopEventData, FlowEventData, RuntimeMode, PermissionAskData, LiveEventData, SkillEntry, SkillWorkspaceKind, SkillWorkspaceRef, ProviderProfile } from '../shared/ipc-types'

// ─── Globals ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let scheduler: Scheduler | null = null
let tray: Tray | null = null
let isQuitting = false

/**
 * Resolve the data directory - data lives next to the program, not in
 * the user home:
 * - portable build: the app self-extracts to a temp dir at runtime, so
 *   PORTABLE_EXECUTABLE_DIR is the only reliable pointer to the real
 *   location of the portable exe
 * - installed build: next to the executable
 * - dev: project-local packages/desktop/data
 */
function resolveDataDir(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) return join(portableDir, 'data')
  if (app.isPackaged) return join(dirname(process.execPath), 'data')
  return join(process.cwd(), 'data')
}

const DATA_DIR = resolveDataDir()

// ─── App settings (userData/settings.json) ─────────────────────────
// Lives OUTSIDE the data dir on purpose: it must survive data-dir
// relocation (otherwise the tasks-dir override could never point
// anywhere else).

interface AppSettings {
  /** Custom tasks directory (registry home + workspace parent). */
  tasksDir?: string
}

const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')

function loadAppSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) as AppSettings
  } catch {
    return {}
  }
}

async function saveAppSettings(patch: AppSettings): Promise<void> {
  const next = { ...loadAppSettings(), ...patch }
  await fs.mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8')
}

/**
 * Resolve a runtime asset (window/tray icons) shipped in resources/:
 * - packaged: electron-builder's extraResources copies them to
 *   <install>/resources/, reachable via process.resourcesPath
 * - dev: the source resources/ dir (out/main -> ../../resources)
 */
function resolveAsset(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(__dirname, '../../resources', name)
}

/**
 * One-time migration from the legacy ~/.sentinel layout: copies
 * tasks/flows into the data dir when they exist there but not yet in
 * the new location. Never overwrites existing data.
 */
async function migrateLegacyData(): Promise<void> {
  const legacyRoot = resolve(app.getPath('home'), '.sentinel')
  for (const sub of ['tasks', 'flows']) {
    const from = join(legacyRoot, sub)
    const to = join(DATA_DIR, sub)
    try {
      await fs.access(to)
      continue // already migrated (or created) - keep it
    } catch {}
    try {
      await fs.access(from)
      await fs.cp(from, to, { recursive: true })
      console.log(`[sentinel] migrated legacy data: ${from} -> ${to}`)
    } catch {}
  }
}

const DEFAULT_TASKS_DIR = join(DATA_DIR, 'tasks')
const FLOWS_DIR = join(DATA_DIR, 'flows')
const APP_SETTINGS = loadAppSettings()
const TASKS_DIR = APP_SETTINGS.tasksDir?.trim() || DEFAULT_TASKS_DIR
const store = new TaskStore({ tasksDir: TASKS_DIR })
const flowStore = new FlowStore({ flowsDir: FLOWS_DIR })

// ─── Serve runtime (R3) ────────────────────────────────────────────
// In serve mode, task runs execute through a shared `opencode serve`
// process: live events stream to the renderer, permission asks become
// dialogs (plus system notifications), and runs can be aborted
// mid-flight. One dynamic executor serves manual runs, scheduled runs
// and flow AI nodes alike; CLI mode simply calls executeTask.

const RUNTIME_FILE = join(DATA_DIR, 'runtime.json')
let runtimeMode: RuntimeMode = 'cli'
let serveServer: OpenCodeServer | null = null
/** Pending permission dialogs: permissionId -> resolve(response) */
const permissionWaiters = new Map<string, (response: PermissionResponse) => void>()
/** Abort controllers of in-flight serve executions, keyed by task name
 *  (a flow may run the same task in several nodes concurrently). */
const taskAbortControllers = new Map<string, Set<AbortController>>()

async function loadRuntimeMode(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(RUNTIME_FILE, 'utf8'))
    if (raw.mode === 'serve' || raw.mode === 'cli') runtimeMode = raw.mode
  } catch {}
}

async function saveRuntimeMode(mode: RuntimeMode): Promise<void> {
  runtimeMode = mode
  try {
    await fs.writeFile(RUNTIME_FILE, JSON.stringify({ mode }, null, 2))
  } catch {}
}

async function getServeServer(): Promise<OpenCodeServer> {
  if (!serveServer) {
    serveServer = await OpenCodeServer.start({
      onLog: (level, msg) => {
        sentinelEvents.emit('scheduler:log', { level, msg: `[serve] ${msg}` })
      },
    })
  }
  return serveServer
}

/** Notify the user out-of-band about a permission ask: system toast that
 *  focuses the window on click, so asks are visible even when the app is
 *  minimized to tray and the Live tab isn't open. */
function notifyPermissionAsk(name: string, ask: PermissionAskData): void {
  try {
    const detail = ask.patterns.length > 0 ? ask.patterns[0] : ask.permission
    const notification = new Notification({
      title: `Sentinel — ${name}`,
      body: `权限请求 ${ask.permission}: ${String(detail).slice(0, 120)}`,
    })
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    notification.show()
  } catch {
    // notifications can be unavailable (platform/settings) - the in-app
    // dialog + timeout-deny still apply
  }
}

/** Executor that routes one execution through the serve runtime. Task
 *  name for event routing comes from the execution config itself, so the
 *  same executor works for tasks AND flow AI nodes. */
function makeServeExecutor(
  server: OpenCodeServer,
): (options: ExecutorOptions) => Promise<ExecutionResult> {
  return async (options) => {
    const name = options.config.name
    const abortController = new AbortController()
    let controllers = taskAbortControllers.get(name)
    if (!controllers) {
      controllers = new Set()
      taskAbortControllers.set(name, controllers)
    }
    controllers.add(abortController)
    try {
      return await server.runTask({
        taskDir: options.taskDir,
        config: options.config,
        promptOverride: options.promptOverride,
        continueSession: options.continueSession,
        abortSignal: abortController.signal,
        onEvent: (event) => {
          mainWindow?.webContents.send(IPC.EVENT_TASK_LIVE, {
            name,
            event: event.kind === 'permission' ? { kind: 'status', status: 'permission-asked' } : event,
          })
        },
        onPermission: (request) =>
          new Promise<PermissionResponse>((resolve) => {
            permissionWaiters.set(request.id, resolve)
            const ask: PermissionAskData = {
              id: request.id,
              sessionId: request.sessionId,
              permission: request.permission,
              patterns: request.patterns,
              metadata: request.metadata,
              always: request.always,
            }
            mainWindow?.webContents.send(IPC.EVENT_TASK_PERMISSION, { name, request: ask })
            notifyPermissionAsk(name, ask)
            // Core denies after its own timeout; this cleanup just drops the waiter.
            setTimeout(() => permissionWaiters.delete(request.id), 130_000)
          }),
      })
    } finally {
      controllers.delete(abortController)
      if (controllers.size === 0) taskAbortControllers.delete(name)
    }
  }
}

/** Mode-aware executor used by manual runs, the scheduler and flow AI
 *  nodes: serve mode when selected (falling back to CLI if the server
 *  can't start), plain CLI otherwise. Decides per execution, so toggling
 *  the mode in Settings applies without restart. */
const dynamicExecutor = async (
  options: ExecutorOptions,
): Promise<ExecutionResult> => {
  if (runtimeMode === 'serve') {
    try {
      const server = await getServeServer()
      return await makeServeExecutor(server)(options)
    } catch (err) {
      sentinelEvents.emit('scheduler:log', {
        level: 'error',
        msg: `[serve] runtime unavailable (${String(err)}), falling back to CLI for ${options.config.name}`,
      })
    }
  }
  return executeTask(options)
}
const flowEngine = new FlowEngine({
  flowStore,
  taskStore: store,
  executeOverride: dynamicExecutor,
  onLog: (level, msg) => {
    // Flow engine logs surface in the scheduler log panel
    sentinelEvents.emit('scheduler:log', { level, msg })
  },
})
/** One run per flow at a time: a waiting manual gate keeps the run
 *  alive indefinitely and concurrent runs would race on .runs.json. */
const flowRunLocks = new Set<string>()

// ─── Window Creation ───────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    icon: resolveAsset('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Minimize to tray on close instead of quitting
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── Forward core events to renderer ───────────────────────────────

function setupEventForwarding(): void {
  sentinelEvents.on('task:status-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_TASK_UPDATE, data)
    }
  })

  sentinelEvents.on('scheduler:log', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_LOG, { ...data, ts: Date.now() })
    }
  })

  sentinelEvents.on('scheduler:started', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_STATUS, { running: true })
    }
  })

  sentinelEvents.on('scheduler:stopped', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_STATUS, { running: false })
    }
  })

  // ── Agent Loop events (Loop Engineering) ──

  const forwardLoop = (data: LoopEventData): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_LOOP_UPDATE, data)
    }
  }

  sentinelEvents.on('loop:iteration-started', (d) => {
    forwardLoop({ event: 'iteration-started', ...d })
  })

  sentinelEvents.on('loop:iteration-completed', (d) => {
    forwardLoop({ event: 'iteration-completed', ...d })
  })

  sentinelEvents.on('loop:verification-failed', (d) => {
    forwardLoop({
      event: 'verification-failed',
      name: d.name,
      iteration: d.iteration,
      verification: { passed: d.verification.passed, message: d.verification.message },
    })
  })

  sentinelEvents.on('loop:completed', (d) => {
    forwardLoop({ event: 'completed', ...d })
  })

  // ── Flow events (Flow Engineering) ──

  const forwardFlow = (data: FlowEventData): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_FLOW_UPDATE, data)
    }
  }

  sentinelEvents.on('flow:started', (d) => {
    forwardFlow({ event: 'started', ...d })
  })

  sentinelEvents.on('flow:node-status-changed', (d) => {
    forwardFlow({ event: 'node-status-changed', ...d })
  })

  sentinelEvents.on('flow:completed', (d) => {
    forwardFlow({ event: 'completed', ...d })
  })

  sentinelEvents.on('flow:manual-gate', (d) => {
    forwardFlow({ event: 'manual-gate', ...d })
    // A gate can wait indefinitely - surface it out-of-band like
    // permission asks so it isn't missed when the window is hidden.
    try {
      const notification = new Notification({
        title: `Sentinel — ${d.name}`,
        body: `人工审批：节点 "${d.node}" 等待你的决定${d.message ? `\n${d.message.slice(0, 120)}` : ''}`,
      })
      notification.on('click', () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      })
      notification.show()
    } catch {
      // notifications can be unavailable - the in-app gate card still applies
    }
  })
}

// ─── IPC Handlers ──────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // ── Tasks ──

  ipcMain.handle(IPC.TASKS_LIST, async () => {
    const names = await store.listTasks()
    const tasks = await Promise.all(
      names.map((n) => store.getTaskInfo(n).catch(() => null)),
    )
    return tasks.filter(Boolean)
  })

  ipcMain.handle(IPC.TASKS_GET, async (_e, name: string) => {
    return store.getTaskInfo(name)
  })

  ipcMain.handle(IPC.TASKS_CREATE, async (_e, opts: CreateTaskOpts) => {
    if (!opts.name) throw new Error('name is required')
    // One directory = one task: the workspace IS the user's directory
    if (!opts.projectDir || !opts.projectDir.trim()) {
      throw new Error('project directory is required')
    }
    const scheduleType = opts.schedule?.type || 'cron'
    if (opts.schedule?.expr && !isValidSchedule(scheduleType, opts.schedule.expr)) {
      throw new Error(`Invalid ${scheduleType} expression: ${opts.schedule.expr}`)
    }

    // Registers the workspace and enforces name + directory uniqueness
    const taskDir = resolve(opts.projectDir.trim())
    await store.createTask(opts.name, taskDir)

    const finalConfig: TaskConfig = {
      name: opts.name,
      description: opts.description || opts.name,
      version: 1,
      schedule: {
        type: (opts.schedule?.type as 'cron' | 'interval' | 'once' | 'at') || 'cron',
        expr: opts.schedule?.expr || '0 9 * * *',
        timezone: opts.schedule?.timezone,
        interval: opts.schedule?.interval,
        maxRuns: opts.schedule?.maxRuns,
      },
      execution: {
        prompt: opts.execution?.prompt || 'No prompt',
        model: opts.execution?.model || undefined,
        agent: opts.execution?.agent || 'default',
        timeout: opts.execution?.timeout || 600,
        session: opts.execution?.session,
        retry: {
          max: opts.execution?.retry?.max ?? 2,
          delay: opts.execution?.retry?.delay ?? 60,
        },
      },
    }

    // Agent Loop config with mode-specific validation
    if (opts.agentLoop?.enabled) {
      const v = opts.agentLoop.verification
      if (v.type === 'command' && !v.command) {
        throw new Error('agentLoop: command verification requires a command')
      }
      if (v.type === 'llm' && !v.criteria) {
        throw new Error('agentLoop: llm verification requires criteria')
      }
      finalConfig.agentLoop = opts.agentLoop
    }

    // Create directories
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
    await fs.mkdir(join(taskDir, '.opencode', 'agents'), { recursive: true })
    await fs.mkdir(join(taskDir, 'scripts'), { recursive: true })
    await fs.mkdir(join(taskDir, 'output'), { recursive: true })

    await store.saveConfig(opts.name, finalConfig)

    const ocConfig = generateOpenCodeConfig(finalConfig, {
      permissions: opts.allowTools,
      denyTools: opts.denyTools,
      externalDirs: opts.externalDirs as ExternalDir[] | undefined,
      skills: opts.skills,
    })
    await store.saveOpenCodeConfig(opts.name, ocConfig)

    // Permission preset: overrides the generated permission section (the
    // generated one is preserved in the sidecar and restored when the card
    // is cleared). Must run after saveOpenCodeConfig or it would be
    // overwritten by the generated config.
    if (opts.permissions) {
      finalConfig.permissions = opts.permissions
      await applyPermissionProfile(taskDir, opts.permissions)
      await store.saveConfig(opts.name, finalConfig)
    }

    // Write AGENTS.md
    await fs.writeFile(
      join(taskDir, '.opencode', 'AGENTS.md'),
      `# ${finalConfig.name}\n\n${finalConfig.description}\n\nThis workspace is managed by Sentinel scheduler.\n`,
      'utf-8',
    )

    // Create skill files
    if (opts.skills && opts.skills.length > 0) {
      for (const skillName of opts.skills) {
        const skillDir = join(taskDir, '.opencode', 'skills', skillName)
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
          join(skillDir, 'SKILL.md'),
          generateSkillContent(skillName, finalConfig.description),
          'utf-8',
        )
      }
    }

    return { ok: true, name: opts.name, dir: taskDir }
  })

  ipcMain.handle(IPC.TASKS_DELETE, async (_e, name: string) => {
    await store.deleteTask(name)
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_PAUSE, async (_e, name: string) => {
    await store.setStatus(name, 'paused')
    sentinelEvents.emit('task:status-changed', { name, status: 'paused' })
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_RESUME, async (_e, name: string) => {
    await store.setStatus(name, 'scheduled')
    sentinelEvents.emit('task:status-changed', { name, status: 'scheduled' })
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_UPDATE, async (_e, name: string, opts: Partial<CreateTaskOpts>) => {
    const existing = await store.getConfig(name)
    if (opts.description !== undefined) existing.description = opts.description
    if (opts.schedule) {
      if (opts.schedule.type) existing.schedule.type = opts.schedule.type as 'cron' | 'interval' | 'once'
      if (opts.schedule.expr) existing.schedule.expr = opts.schedule.expr
      if (opts.schedule.timezone) existing.schedule.timezone = opts.schedule.timezone
    }
    if (opts.execution) {
      if (opts.execution.prompt !== undefined) existing.execution.prompt = opts.execution.prompt
      if (opts.execution.model !== undefined) existing.execution.model = opts.execution.model || undefined
      if (opts.execution.agent !== undefined) existing.execution.agent = opts.execution.agent
      if (opts.execution.timeout !== undefined) existing.execution.timeout = opts.execution.timeout
      if (opts.execution.session !== undefined) existing.execution.session = opts.execution.session
      if (opts.execution.retry !== undefined) {
        existing.execution.retry = {
          max: opts.execution.retry.max ?? existing.execution.retry?.max ?? 2,
          delay: opts.execution.retry.delay ?? existing.execution.retry?.delay ?? 60,
        }
      }
    }
    if (opts.execution?.skills) existing.execution.skills = opts.execution.skills
    if (opts.agentLoop !== undefined) {
      if (opts.agentLoop.enabled) {
        const v = opts.agentLoop.verification
        if (v.type === 'command' && !v.command) {
          throw new Error('agentLoop: command verification requires a command')
        }
        if (v.type === 'llm' && !v.criteria) {
          throw new Error('agentLoop: llm verification requires criteria')
        }
      }
      existing.agentLoop = opts.agentLoop
    }
    await store.saveConfig(name, existing)
    sentinelEvents.emit('task:status-changed', { name, status: 'scheduled' })
    return { ok: true }
  })

  ipcMain.handle(IPC.TASKS_RUN, async (_e, name: string) => {
    const info = await store.getTaskInfo(name)

    // Run lock: refuse when this task is already executing (a scheduled
    // run in flight, or a double-click on the Run button) - concurrent
    // runs of the same task would corrupt history and fight over the
    // session.
    if (info.status === 'running') {
      sentinelEvents.emit('scheduler:log', {
        level: 'warn',
        msg: `Task ${name} is already running - manual trigger ignored`,
      })
      return { ok: false, status: 'already-running' }
    }

    // Mark running immediately so the UI reflects the manual trigger
    await store.setStatus(name, 'running')
    sentinelEvents.emit('task:status-changed', { name, status: 'running' })

    // Run asynchronously - don't await completion. Uses the shared runner
    // so manual runs behave exactly like scheduled runs (agent loop,
    // retries, history persistence, notifications). dynamicExecutor picks
    // serve or CLI mode per run.
    runTaskExecution({
      taskStore: store,
      name,
      info,
      executeOverride: dynamicExecutor,
      onLog: (level, msg) => {
        // Logs are forwarded to the renderer via the scheduler:log event
        sentinelEvents.emit('scheduler:log', { level, msg })
      },
    }).catch((err) => {
      sentinelEvents.emit('scheduler:log', { level: 'error', msg: `Task ${name} error: ${String(err)}` })
    })

    return { ok: true, status: 'running' }
  })

  ipcMain.handle(IPC.RUNTIME_MODE_GET, () => runtimeMode)
  ipcMain.handle(IPC.RUNTIME_MODE_SET, async (_e, mode: RuntimeMode) => {
    await saveRuntimeMode(mode)
    return { ok: true }
  })

  ipcMain.handle(IPC.TASK_PERMISSION_RESPOND, (_e, permissionId: string, response: PermissionResponse) => {
    const waiter = permissionWaiters.get(permissionId)
    if (waiter) {
      permissionWaiters.delete(permissionId)
      waiter(response)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle(IPC.TASK_ABORT, (_e, name: string) => {
    const controllers = taskAbortControllers.get(name)
    if (controllers && controllers.size > 0) {
      for (const controller of controllers) controller.abort()
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle(IPC.TASKS_HISTORY, async (_e, name: string) => {
    return store.getHistory(name)
  })

  ipcMain.handle(IPC.TASKS_WORKSPACE, async (_e, name: string) => {
    const taskDir = store.getTaskDir(name)
    const { promises: fs } = await import('node:fs')

    async function listDir(dir: string, root: string): Promise<TreeNode[]> {
      const result: TreeNode[] = []
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name === '.history.json' || e.name === '.status.json') continue
          const full = join(dir, e.name)
          const rel = full.replace(root, '').replace(/\\/g, '/')
          if (e.isDirectory()) {
            const children = await listDir(full, root)
            result.push({ name: e.name, path: rel, type: 'dir', children })
          } else {
            result.push({ name: e.name, path: rel, type: 'file' })
          }
        }
      } catch {}
      return result
    }

    const tree = await listDir(taskDir, taskDir)
    return { dir: taskDir, tree }
  })

  ipcMain.handle(IPC.TASKS_SKILLS, async (_e, name: string) => {
    const taskDir = store.getTaskDir(name)
    const skillsDir = join(taskDir, '.opencode', 'skills')
    const { promises: fs } = await import('node:fs')
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true })
      const skills: SkillInfo[] = []
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const skillMd = join(skillsDir, e.name, 'SKILL.md')
        try {
          const content = await fs.readFile(skillMd, 'utf-8')
          skills.push({ name: e.name, content })
        } catch {
          skills.push({ name: e.name, content: null })
        }
      }
      return skills
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.TASKS_OUTPUTS, async (_e, name: string) => {
    const taskDir = store.getTaskDir(name)
    const outputDir = join(taskDir, 'output')
    const { promises: fs } = await import('node:fs')
    try {
      const entries = await fs.readdir(outputDir, { withFileTypes: true })
      const files: OutputFile[] = await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name !== '.history.json' && e.name !== '.status.json')
          .map(async (e) => {
            const stat = await fs.stat(join(outputDir, e.name))
            return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
          }),
      )
      return files
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.TASKS_READ_OUTPUT, async (_e, name: string, filename: string) => {
    const taskDir = store.getTaskDir(name)
    // Path traversal check
    const targetPath = resolve(taskDir, 'output', filename)
    if (!targetPath.startsWith(resolve(taskDir, 'output'))) {
      throw new Error('Access denied: path traversal')
    }
    const { promises: fs } = await import('node:fs')
    return fs.readFile(targetPath, 'utf-8')
  })

  ipcMain.handle(IPC.TASKS_SCRIPTS, async (_e, name: string) => {
    const taskDir = store.getTaskDir(name)
    const scriptsDir = join(taskDir, 'scripts')
    const { promises: fs } = await import('node:fs')
    try {
      const entries = await fs.readdir(scriptsDir, { withFileTypes: true })
      return entries.filter((e) => e.isFile()).map((e) => e.name)
    } catch {
      return []
    }
  })

  // ── OpenCode config ──

  ipcMain.handle(IPC.TASKS_OPENCODE_GET, async (_e, name: string) => {
    const config = await store.getOpenCodeConfig(name)
    return config ?? {}
  })

  ipcMain.handle(IPC.TASKS_OPENCODE_UPDATE, async (_e, name: string, config: Record<string, unknown>) => {
    await store.getConfig(name) // verify task exists
    await store.saveOpenCodeConfig(name, config as OpenCodeConfig)
    return { ok: true }
  })

  // ── Flows ──

  ipcMain.handle(IPC.FLOWS_LIST, async () => {
    const names = await flowStore.listFlows()
    const flows = await Promise.all(
      names.map(async (n) => {
        try {
          return {
            config: await flowStore.getConfig(n),
            dir: flowStore.getFlowDir(n),
            runs: await flowStore.getRuns(n),
          }
        } catch {
          return null
        }
      }),
    )
    return flows.filter(Boolean)
  })

  ipcMain.handle(IPC.FLOWS_GET, async (_e, name: string) => {
    return {
      config: await flowStore.getConfig(name),
      dir: flowStore.getFlowDir(name),
      runs: await flowStore.getRuns(name),
    }
  })

  ipcMain.handle(IPC.FLOWS_SAVE, async (_e, name: string, config: FlowConfig) => {
    // Lenient: the editor autosaves while the author is still filling
    // fields (ai task ref, script command) - those make the flow
    // un-runnable, not un-savable. Structural errors still reject.
    const result = validateFlow(config, { lenient: true })
    if (!result.valid) {
      throw new Error(`Invalid flow: ${result.errors.join('; ')}`)
    }
    // Disallow renaming through save - name is the directory identity
    await flowStore.saveConfig(name, { ...config, name })
    return { ok: true }
  })

  ipcMain.handle(IPC.FLOWS_DELETE, async (_e, name: string) => {
    await flowStore.deleteFlow(name)
    return { ok: true }
  })

  ipcMain.handle(IPC.FLOWS_RUN, async (
    _e,
    name: string,
    inputs?: Record<string, string>,
    resumeRunId?: string,
  ) => {
    // Verify the flow loads and is runnable before firing the async run
    // (a draft with missing ai task refs fails here, visibly)
    const config = await flowStore.getConfig(name)
    const validation = validateFlow(config)
    if (!validation.valid) {
      throw new Error(`Invalid flow: ${validation.errors.join('; ')}`)
    }
    if (flowRunLocks.has(name)) {
      throw new Error(`流程 "${name}" 已在运行中（含等待人工审批），请先完成当前运行`)
    }
    flowRunLocks.add(name)
    flowEngine
      .run(name, { inputs, resumeFromRunId: resumeRunId })
      .catch((err) => {
        sentinelEvents.emit('scheduler:log', { level: 'error', msg: `Flow ${name} error: ${String(err)}` })
      })
      .finally(() => flowRunLocks.delete(name))
    return { ok: true }
  })

  ipcMain.handle(IPC.FLOWS_CLONE, async (_e, name: string, newName?: string) => {
    let target = (newName ?? '').trim()
    if (!target) {
      // Auto-name: <name>-copy, <name>-copy-2, ...
      const existing = new Set(await flowStore.listFlows())
      let i = 1
      target = `${name}-copy`
      while (existing.has(target)) target = `${name}-copy-${++i}`
    }
    await flowStore.cloneFlow(name, target)
    return { ok: true, name: target }
  })

  ipcMain.handle(IPC.FLOWS_VALIDATE, (_e, config: FlowConfig) => {
    return validateFlow(config)
  })

  ipcMain.handle(IPC.FLOW_MANUAL_RESOLVE, (
    _e,
    name: string,
    runId: string,
    node: string,
    decision: ManualGateDecision,
  ) => {
    // false = no live gate (already settled or cancelled by budget guard)
    return { ok: flowEngine.resolveManualNode(name, runId, node, decision) }
  })

  ipcMain.handle(IPC.FLOWS_EXPORT, async (_e, name: string) => {
    const config = await flowStore.getConfig(name)
    const options = {
      title: `导出流程 ${name}`,
      defaultPath: `${name}.yaml`,
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false }
    // Definition only - run history and referenced task workspaces stay local
    await fs.writeFile(result.filePath, stringifyYaml(config), 'utf-8')
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle(IPC.FLOWS_IMPORT, async () => {
    const options = {
      title: '导入流程',
      properties: ['openFile' as const],
      filters: [{ name: 'Flow definition', extensions: ['yaml', 'yml', 'json'] }],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: false }
    const raw = await fs.readFile(result.filePaths[0], 'utf-8')
    // YAML 1.2 is a JSON superset, so .json exports parse the same way
    const config = parseYaml(raw) as FlowConfig
    const validation = validateFlow(config)
    if (!validation.valid) {
      throw new Error(`导入的文件不是有效的流程定义：${validation.errors.join('; ')}`)
    }
    // Collision: keep the file's definition but store under a suffixed name
    const existing = new Set(await flowStore.listFlows())
    let target = config.name
    if (existing.has(target)) {
      let i = 2
      while (existing.has(`${config.name}-${i}`)) i++
      target = `${config.name}-${i}`
    }
    await flowStore.saveConfig(target, { ...config, name: target })
    return { ok: true, name: target }
  })

  // ── Skills library ──

  /** Resolve a workspace's skills directory; names are validated so
   *  every derived path stays inside a known workspace. */
  function skillsDir(ref: SkillWorkspaceRef, skillName?: string): string {
    if (!isValidTaskName(ref.workspace)) {
      throw new Error(`Invalid ${ref.kind} name: ${ref.workspace}`)
    }
    const wsDir = ref.kind === 'task' ? store.getTaskDir(ref.workspace) : flowStore.getFlowDir(ref.workspace)
    const dir = join(wsDir, '.opencode', 'skills')
    if (!skillName) return dir
    if (!isValidTaskName(skillName)) {
      throw new Error(`Invalid skill name: ${skillName}`)
    }
    return join(dir, skillName)
  }

  ipcMain.handle(IPC.SKILLS_LIST_ALL, async (): Promise<SkillEntry[]> => {
    const entries: SkillEntry[] = []
    const scan = async (kind: SkillWorkspaceKind, workspaces: string[]): Promise<void> => {
      for (const ws of workspaces) {
        let dirents
        try {
          dirents = await fs.readdir(skillsDir({ kind, workspace: ws }), { withFileTypes: true })
        } catch {
          continue
        }
        for (const e of dirents) {
          if (!e.isDirectory() || !isValidTaskName(e.name)) continue
          const dir = skillsDir({ kind, workspace: ws }, e.name)
          let content: string | null = null
          try {
            content = await fs.readFile(join(dir, 'SKILL.md'), 'utf-8')
          } catch {}
          let extraFiles = 0
          try {
            extraFiles = (await fs.readdir(dir)).filter((f) => f !== 'SKILL.md').length
          } catch {}
          entries.push({ kind, workspace: ws, name: e.name, content, extraFiles })
        }
      }
    }
    await scan('task', await store.listTasks())
    await scan('flow', await flowStore.listFlows())
    return entries
  })

  ipcMain.handle(IPC.SKILLS_SAVE, async (_e, ref: SkillWorkspaceRef, name: string, content: string) => {
    const dir = skillsDir(ref, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), content, 'utf-8')
    return { ok: true }
  })

  ipcMain.handle(IPC.SKILLS_DELETE, async (_e, ref: SkillWorkspaceRef, name: string) => {
    await fs.rm(skillsDir(ref, name), { recursive: true, force: true })
    return { ok: true }
  })

  ipcMain.handle(IPC.SKILLS_COPY, async (
    _e,
    from: SkillWorkspaceRef & { name: string },
    to: SkillWorkspaceRef,
  ) => {
    const target = skillsDir(to, from.name)
    try {
      await fs.access(target)
      throw new Error(`技能 "${from.name}" 在目标工作区已存在`)
    } catch (err) {
      if ((err as Error).message.includes('已存在')) throw err
    }
    await fs.cp(skillsDir(from, from.name), target, { recursive: true })
    return { ok: true }
  })

  ipcMain.handle(IPC.SKILLS_EXPORT, async (_e, ref: SkillWorkspaceRef, name: string) => {
    const content = await fs.readFile(join(skillsDir(ref, name), 'SKILL.md'), 'utf-8')
    const options = {
      title: `导出技能 ${name}`,
      defaultPath: `${name}-skill.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false }
    // SKILL.md only - supporting files stay in the workspace
    await fs.writeFile(result.filePath, content, 'utf-8')
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle(IPC.SKILLS_IMPORT, async (_e, to: SkillWorkspaceRef) => {
    const options = {
      title: '导入技能',
      properties: ['openFile' as const],
      filters: [{ name: 'Skill definition', extensions: ['md', 'markdown'] }],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: false }
    const file = result.filePaths[0]
    const name = basename(file).replace(/\.(md|markdown)$/i, '')
    if (!isValidTaskName(name)) {
      throw new Error(`文件名不是有效的技能名：${name}`)
    }
    const target = skillsDir(to, name)
    try {
      await fs.access(target)
      throw new Error(`技能 "${name}" 在目标工作区已存在`)
    } catch (err) {
      if ((err as Error).message.includes('已存在')) throw err
    }
    const content = await fs.readFile(file, 'utf-8')
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(join(target, 'SKILL.md'), content, 'utf-8')
    return { ok: true, name }
  })

  // ── Scheduler ──

  ipcMain.handle(IPC.SCHEDULER_START, async () => {
    if (scheduler?.isRunning) return { ok: true }
    await store.init()
    await flowStore.init()
    scheduler = new Scheduler({ taskStore: store, flowStore, concurrency: 3, checkIntervalMs: 60_000, executeOverride: dynamicExecutor })
    scheduler.setLogger((level, msg) => {
      // Logs are forwarded via sentinelEvents — no additional action needed
    })
    scheduler.start()
    return { ok: true }
  })

  ipcMain.handle(IPC.SCHEDULER_STOP, () => {
    if (!scheduler?.isRunning) return { ok: true }
    scheduler.stop()
    scheduler = null
    return { ok: true }
  })

  ipcMain.handle(IPC.SCHEDULER_STATUS, () => {
    return { running: scheduler?.isRunning ?? false }
  })

  // ── Window controls ──

  ipcMain.handle(IPC.WINDOW_MINIMIZE, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, (e) => {
    // Hide to tray instead of closing
    BrowserWindow.fromWebContents(e.sender)?.hide()
  })

  // ── App ──

  ipcMain.handle(IPC.APP_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC.APP_DATA, () => {
    return DATA_DIR
  })

  ipcMain.handle(IPC.TASKS_DIR_INFO, () => {
    const current = store.getTasksDir()
    const norm = (p: string): string =>
      resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return {
      current,
      defaultDir: DEFAULT_TASKS_DIR,
      overridden: norm(current) !== norm(DEFAULT_TASKS_DIR),
    }
  })

  ipcMain.handle(IPC.TASKS_DIR_CHOOSE, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: '选择任务目录 / Choose tasks directory',
      properties: ['openDirectory', 'createDirectory'],
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(
    IPC.TASKS_DIR_SET,
    async (_e, opts: { dir: string; migrate: boolean }) => {
      const dir = resolve(String(opts?.dir ?? '').trim())
      if (!dir || parse(dir).root === dir) {
        throw new Error('无效的任务目录')
      }
      await fs.mkdir(dir, { recursive: true })
      let moved = 0
      if (opts.migrate) {
        moved = await store.migrateTasksTo(dir)
      } else {
        // No migration: still refuse an overlapping directory (the new
        // store would adopt the old location's workspaces)
        const norm = (p: string): string =>
          resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const cur = norm(store.getTasksDir())
        const next = norm(dir)
        if (cur === next || next.startsWith(cur + '/') || cur.startsWith(next + '/')) {
          throw new Error('新目录不能与当前任务目录重叠')
        }
      }
      await saveAppSettings({ tasksDir: dir })
      return { ok: true, moved }
    },
  )

  ipcMain.handle(IPC.APP_RESTART, () => {
    app.relaunch()
    app.exit(0)
  })

  // ── Provider profiles (userData/providers.json) ──

  ipcMain.handle(IPC.PROVIDERS_LIST, () => listProviderProfiles())

  ipcMain.handle(IPC.PROVIDERS_SAVE, (_e, profile: ProviderProfile) => {
    if (!profile.name?.trim() || !profile.provider?.trim() || !profile.model?.trim()) {
      throw new Error('name/provider/model are required')
    }
    const profiles = listProviderProfiles()
    const id = profile.id?.trim() || slugify(profile.name)
    if (!profile.id?.trim() && profiles.some((p) => p.id === id)) {
      throw new Error(`Profile already exists: ${id}`)
    }
    const next = { ...profile, id }
    const idx = profiles.findIndex((p) => p.id === id)
    if (idx >= 0) profiles[idx] = next
    else profiles.push(next)
    saveProviderProfiles(profiles)
    return { ok: true, profile: next }
  })

  ipcMain.handle(IPC.PROVIDERS_DELETE, (_e, id: string) => {
    saveProviderProfiles(listProviderProfiles().filter((p) => p.id !== id))
    return { ok: true }
  })

  // Bind/unbind a provider profile on a task: compiles the profile into
  // the task workspace's .opencode config (field-level merge) and records
  // the profile id in task.yaml.
  ipcMain.handle(IPC.TASK_BIND_PROVIDER, async (_e, name: string, profileId: string | null) => {
    const dir = store.getTaskDir(name)
    const config = await store.getConfig(name)
    if (profileId) {
      const profile = listProviderProfiles().find((p) => p.id === profileId)
      if (!profile) throw new Error(`Unknown provider profile: ${profileId}`)
      await applyProviderBinding(dir, {
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      })
      config.execution.providerProfile = profile.id
    } else {
      await applyProviderBinding(dir, null)
      delete config.execution.providerProfile
    }
    await store.saveConfig(name, config)
    return { ok: true }
  })

  // Permission card: read a task's profile and whether it is currently
  // compiled into the workspace .opencode config.
  ipcMain.handle(IPC.TASK_PERMISSION_GET, async (_e, name: string) => {
    const dir = store.getTaskDir(name)
    const config = await store.getConfig(name)
    return { profile: config.permissions ?? null, applied: await hasPermissionProfile(dir) }
  })

  // Permission card: apply (or clear) the profile - compiles into the
  // workspace .opencode config and records it in task.yaml.
  ipcMain.handle(IPC.TASK_PERMISSION_SET, async (_e, name: string, profile: PermissionProfile | null) => {
    if (profile && !['readonly', 'standard', 'trusted', 'custom'].includes(profile.preset)) {
      throw new Error(`Unknown permission preset: ${profile.preset}`)
    }
    const dir = store.getTaskDir(name)
    await applyPermissionProfile(dir, profile)
    const config = await store.getConfig(name)
    if (profile) config.permissions = profile
    else delete config.permissions
    await store.saveConfig(name, config)
    return { ok: true }
  })

  // Discover models on an OpenAI-compatible endpoint (GET /models with
  // candidate paths, mirroring cc-switch's approach).
  ipcMain.handle(IPC.PROVIDERS_FETCH_MODELS, async (_e, opts: { baseUrl: string; apiKey?: string }) => {
    const base = String(opts?.baseUrl ?? '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\//.test(base)) throw new Error('invalid baseUrl')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (opts?.apiKey) headers.authorization = `Bearer ${opts.apiKey}`
    const candidates = base.endsWith('/v1')
      ? [`${base}/models`]
      : [`${base}/v1/models`, `${base}/models`]
    let lastError = 'request failed'
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) {
          lastError = `HTTP ${res.status} ${url}`
          continue
        }
        const body = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>
        const list = Array.isArray(body) ? body : body.data
        const ids = [...new Set((list ?? []).map((m) => m?.id).filter((x): x is string => !!x))].sort()
        if (ids.length > 0) return { ok: true, models: ids }
        lastError = `no models in response from ${url}`
      } catch (err) {
        lastError = String(err)
      }
    }
    throw new Error(lastError)
  })

  // Model list from the local opencode CLI (`opencode models`): every
  // model this machine can actually run - Zen free tier, authenticated
  // providers, global-config providers. Cached ~5 minutes.
  let modelsCache: { models: string[]; at: number } | null = null
  ipcMain.handle(IPC.MODELS_LIST, async () => {
    if (modelsCache && Date.now() - modelsCache.at < 5 * 60_000) {
      return { ok: true, models: modelsCache.models }
    }
    const bin =
      process.platform === 'win32' ? resolveWindowsBinary('opencode') : 'opencode'
    const { stdout } = await promisify(execFile)(bin, ['models'], {
      timeout: 15_000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    })
    const models = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[a-z0-9_-]+\/\S+$/i.test(l))
    modelsCache = { models, at: Date.now() }
    return { ok: true, models }
  })
}

// ─── Provider profiles storage (userData/providers.json) ───────────

function providersFile(): string {
  return join(app.getPath('userData'), 'providers.json')
}

function listProviderProfiles(): ProviderProfile[] {
  try {
    const raw = readFileSync(providersFile(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.profiles) ? parsed.profiles : []
  } catch {
    return []
  }
}

function saveProviderProfiles(profiles: ProviderProfile[]): void {
  const file = providersFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, profiles }, null, 2), 'utf-8')
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `profile-${Date.now()}`
  )
}

/** Recompile every bound task's workspace config from its profile -
 *  keeps endpoints/keys in sync after a profile edit or key rotation. */
async function recompileProviderBindings(): Promise<void> {
  const profiles = listProviderProfiles()
  for (const name of await store.listTasks()) {
    try {
      const config = await store.getConfig(name)
      const profileId = config.execution.providerProfile
      if (!profileId) continue
      const profile = profiles.find((p) => p.id === profileId)
      if (!profile) continue
      await applyProviderBinding(store.getTaskDir(name), {
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
      })
    } catch (err) {
      console.error(`[sentinel] provider recompile failed for ${name}:`, err)
    }
  }
}

// ─── System Tray ────────────────────────────────────────────────────

function createTray(): void {
  // Prefer the real tray icon; fall back to the programmatic circle if the
  // asset is somehow missing at runtime.
  const image = nativeImage.createFromPath(resolveAsset('tray.png'))
  const icon = image.isEmpty() ? nativeImage.createFromBuffer(createDefaultIcon()) : image
  tray = new Tray(icon)
  tray.setToolTip('Sentinel AI Scheduler')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  // Double-click tray icon to show window
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

/**
 * Generate a minimal 16x16 PNG icon buffer programmatically
 * (a small blue circle on transparent background)
 */
function createDefaultIcon(): Buffer {
  // Minimal valid 16x16 RGBA PNG
  const size = 16
  const { createCanvas } = (() => {
    // Create raw RGBA data
    const data = Buffer.alloc(size * size * 4, 0)
    const cx = 7.5, cy = 7.5, r = 6
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * size + x) * 4
        if (dist <= r) {
          data[i] = 59     // R (blue-ish: #3B82F6)
          data[i + 1] = 130  // G
          data[i + 2] = 246  // B
          data[i + 3] = 255  // A
        }
      }
    }
    return { createCanvas: () => data }
  })()

  // Encode as PNG manually (minimal valid PNG)
  return encodePNG(createCanvas(), size)
}

function encodePNG(rgba: Buffer, width: number): Buffer {
  const height = width
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type: RGBA
  ihdrData[10] = 0 // compression
  ihdrData[11] = 0 // filter
  ihdrData[12] = 0 // interlace
  const ihdr = createChunk('IHDR', ihdrData)

  // IDAT chunk (raw scanlines with filter byte 0 per row)
  const { deflateSync } = require('node:zlib')
  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0 // filter: None
    rgba.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = deflateSync(rawData)
  const idat = createChunk('IDAT', compressed)

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ─── Application Menu ──────────────────────────────────────────────

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Task', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-task') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Learn More', click: () => shell.openExternal('https://github.com/Wswjcl/Sentinel') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── App Lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.sentinel.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await migrateLegacyData()
  await loadRuntimeMode()
  await store.init()
  await flowStore.init()
  // Recompile provider bindings so profile edits (endpoint/key rotation)
  // propagate to all bound task workspaces
  void recompileProviderBindings()
  // A quit while a flow was running (e.g. waiting on a manual gate)
  // leaves the run stuck at 'running' with no live engine to finish
  // it - mark those runs failed so history reflects reality.
  for (const flowName of await flowStore.listFlows()) {
    const runs = await flowStore.getRuns(flowName)
    let dirty = false
    for (const r of runs) {
      if (r.status !== 'running') continue
      r.status = 'failed'
      r.finishedAt = new Date().toISOString()
      for (const nr of Object.values(r.nodes)) {
        if (nr.status === 'pending' || nr.status === 'running' || nr.status === 'waiting') {
          nr.status = 'skipped'
          nr.skipReason = 'unreachable'
        }
      }
      dirty = true
    }
    if (dirty) await flowStore.saveRuns(flowName, runs)
  }
  setupMenu()
  registerIpcHandlers()
  setupEventForwarding()
  createTray()
  createWindow()
})

app.on('window-all-closed', () => {
  // Don't quit — tray keeps the app alive
})

app.on('before-quit', () => {
  isQuitting = true
  scheduler?.stop()
})

app.on('activate', () => {
  // macOS: click dock icon to show window
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow?.show()
})
