import { app, BrowserWindow, ipcMain, Menu, shell, Tray, nativeImage } from 'electron'
import { join, resolve } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { TaskStore, FlowStore, FlowEngine, Scheduler, runTaskExecution, validateFlow, isValidCron, isValidSchedule, generateOpenCodeConfig, generateSkillContent, sentinelEvents } from '@sentinel/core'
import type { TaskConfig, ExternalDir, OpenCodeConfig, FlowConfig } from '@sentinel/core'
import { IPC } from '../shared/ipc-types'
import type { CreateTaskOpts, TreeNode, OutputFile, SkillInfo, LoopEventData, FlowEventData } from '../shared/ipc-types'

// ─── Globals ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let scheduler: Scheduler | null = null
let tray: Tray | null = null
let isQuitting = false

const TASKS_DIR = resolve(app.getPath('home'), '.sentinel', 'tasks')
const FLOWS_DIR = resolve(app.getPath('home'), '.sentinel', 'flows')
const store = new TaskStore({ tasksDir: TASKS_DIR })
const flowStore = new FlowStore({ flowsDir: FLOWS_DIR })
const flowEngine = new FlowEngine({
  flowStore,
  taskStore: store,
  onLog: (level, msg) => {
    // Flow engine logs surface in the scheduler log panel
    sentinelEvents.emit('scheduler:log', { level, msg })
  },
})

// ─── Window Creation ───────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
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
    const scheduleType = opts.schedule?.type || 'cron'
    if (opts.schedule?.expr && !isValidSchedule(scheduleType, opts.schedule.expr)) {
      throw new Error(`Invalid ${scheduleType} expression: ${opts.schedule.expr}`)
    }

    const taskDir = opts.projectDir
      ? (resolve(opts.projectDir) === opts.projectDir ? opts.projectDir : resolve(opts.projectDir))
      : store.getTaskDir(opts.name)

    // Check if already exists
    try {
      await store.getConfig(opts.name)
      throw new Error('Workspace already exists')
    } catch (err: any) {
      if (err.message !== 'Workspace already exists') {
        // Task doesn't exist yet — good
      } else {
        throw err
      }
    }

    const finalConfig: TaskConfig = {
      name: opts.name,
      description: opts.description || opts.name,
      version: 1,
      schedule: {
        type: (opts.schedule?.type as 'cron' | 'interval' | 'once') || 'cron',
        expr: opts.schedule?.expr || '0 9 * * *',
        timezone: opts.schedule?.timezone || 'Asia/Shanghai',
      },
      execution: {
        prompt: opts.execution?.prompt || 'No prompt',
        model: opts.execution?.model || undefined,
        agent: opts.execution?.agent || 'default',
        timeout: opts.execution?.timeout || 600,
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

    // Mark running immediately so the UI reflects the manual trigger
    await store.setStatus(name, 'running')
    sentinelEvents.emit('task:status-changed', { name, status: 'running' })

    // Run asynchronously - don't await completion. Uses the shared runner
    // so manual runs behave exactly like scheduled runs (agent loop,
    // retries, history persistence, notifications).
    runTaskExecution({
      taskStore: store,
      name,
      info,
      onLog: (level, msg) => {
        // Logs are forwarded to the renderer via the scheduler:log event
        sentinelEvents.emit('scheduler:log', { level, msg })
      },
    }).catch((err) => {
      sentinelEvents.emit('scheduler:log', { level: 'error', msg: `Task ${name} error: ${String(err)}` })
    })

    return { ok: true, status: 'running' }
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
    const result = validateFlow(config)
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

  ipcMain.handle(IPC.FLOWS_RUN, async (_e, name: string, inputs?: Record<string, string>) => {
    // Verify the flow loads before firing the async run
    await flowStore.getConfig(name)
    flowEngine.run(name, { inputs }).catch((err) => {
      sentinelEvents.emit('scheduler:log', { level: 'error', msg: `Flow ${name} error: ${String(err)}` })
    })
    return { ok: true }
  })

  ipcMain.handle(IPC.FLOWS_VALIDATE, (_e, config: FlowConfig) => {
    return validateFlow(config)
  })

  // ── Scheduler ──

  ipcMain.handle(IPC.SCHEDULER_START, async () => {
    if (scheduler?.isRunning) return { ok: true }
    await store.init()
    await flowStore.init()
    scheduler = new Scheduler({ taskStore: store, flowStore, concurrency: 3, checkIntervalMs: 60_000 })
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
}

// ─── System Tray ────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createFromBuffer(createDefaultIcon())
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

  await store.init()
  await flowStore.init()
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
