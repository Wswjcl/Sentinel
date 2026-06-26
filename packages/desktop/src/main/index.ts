import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join, resolve } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { TaskStore, Scheduler, executeTask, isValidCron, generateOpenCodeConfig, generateSkillContent, wwcEvents } from '@wwc/core'
import type { TaskConfig, ExternalDir, OpenCodeConfig } from '@wwc/core'
import { IPC } from '../shared/ipc-types'
import type { CreateTaskOpts, TreeNode, OutputFile, SkillInfo } from '../shared/ipc-types'

// ─── Globals ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let scheduler: Scheduler | null = null

const TASKS_DIR = resolve(app.getPath('home'), '.wwc', 'tasks')
const store = new TaskStore({ tasksDir: TASKS_DIR })

// ─── Window Creation ───────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarOverlay: {
      color: '#0d1117',
      symbolColor: '#c9d1d9',
      height: 40,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    backgroundThrottling: false,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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
  wwcEvents.on('task:status-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_TASK_UPDATE, data)
    }
  })

  wwcEvents.on('scheduler:log', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_LOG, { ...data, ts: Date.now() })
    }
  })

  wwcEvents.on('scheduler:started', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_STATUS, { running: true })
    }
  })

  wwcEvents.on('scheduler:stopped', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.EVENT_SCHEDULER_STATUS, { running: false })
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
    if (opts.schedule?.expr && !isValidCron(opts.schedule.expr)) {
      throw new Error('Invalid cron expression')
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
      `# ${finalConfig.name}\n\n${finalConfig.description}\n\nThis workspace is managed by WWC scheduler.\n`,
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

  ipcMain.handle(IPC.TASKS_RUN, async (_e, name: string) => {
    const info = await store.getTaskInfo(name)

    // Run asynchronously — don't await completion
    executeTask({ taskDir: info.dir, config: info.config })
      .then(async (result) => {
        const history = await store.getHistory(name)
        history.push(result.record)
        await store.saveHistory(name, history)
        await store.setStatus(name, result.record.status === 'success' ? 'scheduled' : 'failed')
        wwcEvents.emit('task:status-changed', {
          name,
          status: result.record.status === 'success' ? 'scheduled' : 'failed',
        })
        wwcEvents.emit('task:run-completed', { name, record: result.record })
      })
      .catch(async (err) => {
        wwcEvents.emit('scheduler:log', { level: 'error', msg: `Task ${name} error: ${String(err)}` })
        await store.setStatus(name, 'failed')
        wwcEvents.emit('task:status-changed', { name, status: 'failed' })
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

  // ── Scheduler ──

  ipcMain.handle(IPC.SCHEDULER_START, async () => {
    if (scheduler?.isRunning) return { ok: true }
    await store.init()
    scheduler = new Scheduler({ taskStore: store, concurrency: 3, checkIntervalMs: 60_000 })
    scheduler.setLogger((level, msg) => {
      // Logs are forwarded via wwcEvents — no additional action needed
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
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
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
        { label: 'Learn More', click: () => shell.openExternal('https://github.com/wwc-dev/wwc') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── App Lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.wwc.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await store.init()
  setupMenu()
  registerIpcHandlers()
  setupEventForwarding()
  createWindow()
})

app.on('window-all-closed', () => {
  scheduler?.stop()
  app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
})
