import { Command } from 'commander'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { TaskStore, Scheduler, executeTask, isValidCron } from '@wwc/core'
import type { TaskConfig } from '@wwc/core'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
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
      const config = req.body as TaskConfig & { name: string }

      if (!config.name) {
        res.status(400).json({ error: 'name is required' })
        return
      }
      if (config.schedule?.expr && !isValidCron(config.schedule.expr)) {
        res.status(400).json({ error: 'Invalid cron expression' })
        return
      }

      const taskDir = store.getTaskDir(config.name)
      try {
        await fs.access(taskDir)
        res.status(409).json({ error: 'Task already exists' })
        return
      } catch {}

      const finalConfig: TaskConfig = {
        name: config.name,
        description: config.description || config.name,
        version: 1,
        schedule: {
          type: config.schedule?.type || 'cron',
          expr: config.schedule?.expr || '0 9 * * *',
          timezone: config.schedule?.timezone || 'Asia/Shanghai',
        },
        execution: {
          prompt: config.execution?.prompt || 'No prompt',
          model: config.execution?.model || undefined,
          agent: config.execution?.agent || 'default',
          timeout: config.execution?.timeout || 600,
          retry: config.execution?.retry || { max: 2, delay: 60 },
        },
        notify: config.notify,
      }

      await store.saveConfig(config.name, finalConfig)
      await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })

      emitUpdate()
      res.status(201).json({ ok: true, name: config.name })
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

