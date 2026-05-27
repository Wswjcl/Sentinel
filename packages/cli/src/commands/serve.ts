import { Command } from 'commander'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { TaskStore, Scheduler, executeTask, isValidCron, generateOpenCodeConfig, generateSkillContent } from '@wwc/core'
import type { TaskConfig, ExternalDir } from '@wwc/core'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

interface SSEClient {
  id: string
  res: Response
}

function createSSE(res: Response, clients: Set<SSEClient>): SSEClient {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(':\n\n')

  const client: SSEClient = { id: randomUUID(), res }
  clients.add(client)

  res.on('close', () => {
    clients.delete(client)
  })

  return client
}

function broadcastSSE(clients: Set<SSEClient>, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try { client.res.write(payload) } catch {}
  }
}

let globalScheduler: Scheduler | null = null
const sseClients = new Set<SSEClient>()

function getStore(tasksDir: string): TaskStore {
  return new TaskStore({ tasksDir })
}

export const serveCommand = new Command('serve')
  .description('Start the web dashboard server')
  .option('--port <port>', 'Port to listen on', '3456')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .action(async (options: { port: string; tasksDir: string }) => {
    const app = express()
    const port = parseInt(options.port, 10)

    app.use(cors())
    app.use(express.json())

    function emitUpdate(): void {
      broadcastSSE(sseClients, 'update', { ts: Date.now() })
    }

    app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', schedulerRunning: globalScheduler?.isRunning ?? false })
    })

    app.get('/api/events', (_req: Request, res: Response) => {
      createSSE(res, sseClients)
    })

    app.get('/api/tasks', async (_req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const names = await store.listTasks()
      const tasks = await Promise.all(
        names.map((n) => store.getTaskInfo(n).catch(() => null)),
      )
      res.json(tasks.filter(Boolean))
    })

    app.get('/api/tasks/:name', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      try {
        const info = await store.getTaskInfo(req.params.name as string)
        res.json(info)
      } catch {
        res.status(404).json({ error: 'Task not found' })
      }
    })

    app.post('/api/tasks', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const body = req.body as {
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
        }
        skills?: string[]
        externalDirs?: ExternalDir[]
        allowTools?: string[]
        denyTools?: string[]
        notify?: unknown
      }

      if (!body.name) {
        res.status(400).json({ error: 'name is required' })
        return
      }
      if (body.schedule?.expr && !isValidCron(body.schedule.expr)) {
        res.status(400).json({ error: 'Invalid cron expression' })
        return
      }

      const taskDir = body.projectDir
        ? (isAbsolute(body.projectDir) ? body.projectDir : resolve(body.projectDir))
        : store.getTaskDir(body.name)

      try {
        await fs.access(taskDir)
        res.status(409).json({ error: 'Workspace already exists' })
        return
      } catch {}

      const finalConfig: TaskConfig = {
        name: body.name,
        description: body.description || body.name,
        version: 1,
        schedule: {
          type: (body.schedule?.type as 'cron' | 'interval' | 'once') || 'cron',
          expr: body.schedule?.expr || '0 9 * * *',
          timezone: body.schedule?.timezone || 'Asia/Shanghai',
        },
        execution: {
          prompt: body.execution?.prompt || 'No prompt',
          model: body.execution?.model || undefined,
          agent: body.execution?.agent || 'default',
          timeout: body.execution?.timeout || 600,
          retry: {
            max: body.execution?.retry?.max ?? 2,
            delay: body.execution?.retry?.delay ?? 60,
          },
        },
        notify: body.notify as TaskConfig['notify'],
      }

      await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
      await fs.mkdir(join(taskDir, '.opencode', 'agents'), { recursive: true })
      await fs.mkdir(join(taskDir, 'scripts'), { recursive: true })
      await fs.mkdir(join(taskDir, 'output'), { recursive: true })

      await store.saveConfig(body.name, finalConfig)

      const ocConfig = generateOpenCodeConfig(finalConfig, {
        permissions: body.allowTools,
        denyTools: body.denyTools,
        externalDirs: body.externalDirs,
        skills: body.skills,
      })
      await store.saveOpenCodeConfig(body.name, ocConfig)

      await fs.writeFile(
        join(taskDir, '.opencode', 'AGENTS.md'),
        `# ${finalConfig.name}\n\n${finalConfig.description}\n\nThis workspace is managed by WWC scheduler.\n`,
        'utf-8',
      )

      if (body.skills && body.skills.length > 0) {
        for (const skillName of body.skills) {
          const skillDir = join(taskDir, '.opencode', 'skills', skillName)
          await fs.mkdir(skillDir, { recursive: true })
          await fs.writeFile(
            join(skillDir, 'SKILL.md'),
            generateSkillContent(skillName, finalConfig.description),
            'utf-8',
          )
        }
      }

      emitUpdate()
      res.status(201).json({ ok: true, name: body.name, dir: taskDir })
    })

    app.delete('/api/tasks/:name', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      try {
        await store.getConfig(req.params.name as string)
      } catch {
        res.status(404).json({ error: 'Task not found' })
        return
      }
      await store.deleteTask(req.params.name as string)
      emitUpdate()
      res.json({ ok: true })
    })

    app.post('/api/tasks/:name/run', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      let info
      try {
        info = await store.getTaskInfo(req.params.name as string)
      } catch {
        res.status(404).json({ error: 'Task not found' })
        return
      }

      res.json({ ok: true, status: 'running' })

      try {
        const result = await executeTask({
          taskDir: info.dir,
          config: info.config,
        })
        const history = await store.getHistory(req.params.name as string)
        history.push(result.record)
        await store.saveHistory(req.params.name as string, history)
        emitUpdate()
      } catch (err) {
        console.error('Task execution error:', err)
        emitUpdate()
      }
    })

    app.get('/api/tasks/:name/history', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      try {
        const history = await store.getHistory(req.params.name as string)
        res.json(history)
      } catch {
        res.status(404).json({ error: 'Task not found' })
      }
    })

    app.get('/api/tasks/:name/output', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      try {
        const history = await store.getHistory(req.params.name as string)
        const last = history[history.length - 1]
        if (last?.output) {
          res.type('text/plain').send(last.output)
        } else {
          res.json({ output: null })
        }
      } catch {
        res.status(404).json({ error: 'Task not found' })
      }
    })

    app.get('/api/tasks/:name/opencode', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      try {
        const config = await store.getOpenCodeConfig(req.params.name as string)
        res.json(config ?? {})
      } catch {
        res.status(404).json({ error: 'Task not found' })
      }
    })

    interface TreeNode {
      name: string
      path: string
      type: 'file' | 'dir'
      children?: TreeNode[]
    }

    async function listDirInner(dir: string, root: string): Promise<TreeNode[]> {
      const result: TreeNode[] = []
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          const full = join(dir, e.name)
          const rel = full.replace(root, '').replace(/\\/g, '/')
          if (e.isDirectory()) {
            const children = await listDirInner(full, root)
            result.push({ name: e.name, path: rel, type: 'dir', children })
          } else {
            result.push({ name: e.name, path: rel, type: 'file' })
          }
        }
      } catch {}
      return result
    }

    async function listDir(dir: string, root: string): Promise<TreeNode[]> {
      const result: TreeNode[] = []
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.name === '.history.json') continue
          const full = join(dir, e.name)
          const rel = full.replace(root, '').replace(/\\/g, '/')
          if (e.isDirectory()) {
            const children = await listDirInner(full, root)
            result.push({ name: e.name, path: rel, type: 'dir', children })
          } else {
            result.push({ name: e.name, path: rel, type: 'file' })
          }
        }
      } catch {}
      return result
    }

    app.get('/api/tasks/:name/workspace', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const taskDir = store.getTaskDir(req.params.name as string)
      try {
        await fs.access(taskDir)
      } catch {
        res.status(404).json({ error: 'Task not found' })
        return
      }
      const tree = await listDir(taskDir, taskDir)
      res.json({ dir: taskDir, tree })
    })

    app.get('/api/tasks/:name/skills', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const taskDir = store.getTaskDir(req.params.name as string)
      const skillsDir = join(taskDir, '.opencode', 'skills')
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true })
        const skills = []
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
        res.json(skills)
      } catch {
        res.json([])
      }
    })

    app.get('/api/tasks/:name/scripts', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const taskDir = store.getTaskDir(req.params.name as string)
      const scriptsDir = join(taskDir, 'scripts')
      try {
        const entries = await fs.readdir(scriptsDir, { withFileTypes: true })
        const scripts = entries.filter(e => e.isFile()).map(e => e.name)
        res.json(scripts)
      } catch {
        res.json([])
      }
    })

    app.get('/api/tasks/:name/outputs', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const taskDir = store.getTaskDir(req.params.name as string)
      const outputDir = join(taskDir, 'output')
      try {
        const entries = await fs.readdir(outputDir, { withFileTypes: true })
        const files = await Promise.all(
          entries
            .filter(e => e.isFile() && e.name !== '.history.json')
            .map(async (e) => {
              const stat = await fs.stat(join(outputDir, e.name))
              return {
                name: e.name,
                size: stat.size,
                mtime: stat.mtime.toISOString(),
              }
            }),
        )
        res.json(files)
      } catch {
        res.json([])
      }
    })

    app.get('/api/tasks/:name/output-file/:filename', async (req: Request, res: Response) => {
      const store = getStore(options.tasksDir)
      const taskDir = store.getTaskDir(req.params.name as string)
      const filePath = join(taskDir, 'output', req.params.filename as string)
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        res.type('text/plain').send(content)
      } catch {
        res.status(404).json({ error: 'File not found' })
      }
    })

    app.get('/api/scheduler', (_req: Request, res: Response) => {
      res.json({
        running: globalScheduler?.isRunning ?? false,
      })
    })

    app.post('/api/scheduler/start', async (_req: Request, res: Response) => {
      if (globalScheduler?.isRunning) {
        res.json({ ok: true, message: 'Already running' })
        return
      }
      const store = getStore(options.tasksDir)
      await store.init()

      globalScheduler = new Scheduler({
        taskStore: store,
        concurrency: 3,
        checkIntervalMs: 60_000,
      })

      globalScheduler.setLogger((level, msg) => {
        console.log(`[${level.toUpperCase()}] ${msg}`)
        broadcastSSE(sseClients, 'log', { level, msg, ts: Date.now() })
      })

      globalScheduler.start()
      emitUpdate()
      res.json({ ok: true })
    })

    app.post('/api/scheduler/stop', (_req: Request, res: Response) => {
      if (!globalScheduler?.isRunning) {
        res.json({ ok: true, message: 'Not running' })
        return
      }
      globalScheduler.stop()
      globalScheduler = null
      emitUpdate()
      res.json({ ok: true })
    })

    const __dirname = dirname(fileURLToPath(import.meta.url))
    app.get('/', (_req: Request, res: Response) => {
      res.sendFile(join(__dirname, '..', 'web', 'dashboard.html'))
    })

    app.get('/favicon.ico', (_req: Request, res: Response) => {
      res.status(204).end()
    })

    const server = createServer(app)

    server.on('close', () => {
      globalScheduler?.stop()
    })

    server.listen(port, () => {
      console.log(`
╔══════════════════════════════════════════════╗
�?         WWC Dashboard                       �?�?  Open http://localhost:${port} in your browser   �?╚══════════════════════════════════════════════╝
`)
    })

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

