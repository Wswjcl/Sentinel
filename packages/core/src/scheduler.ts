import { TaskStore } from './task-store.js'
import { executeTask } from './executor.js'
import { shouldRunNow } from './cron.js'
import type { TaskInfo } from './types.js'

export interface SchedulerOptions {
  taskStore: TaskStore
  concurrency?: number
  checkIntervalMs?: number
  opencodeBin?: string
}

export class Scheduler {
  private store: TaskStore
  private concurrency: number
  private checkIntervalMs: number
  private opencodeBin: string
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  private onLog?: (level: string, msg: string) => void

  constructor(options: SchedulerOptions) {
    this.store = options.taskStore
    this.concurrency = options.concurrency ?? 3
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000
    this.opencodeBin = options.opencodeBin ?? 'opencode'
  }

  setLogger(cb: (level: string, msg: string) => void): void {
    this.onLog = cb
  }

  private log(level: string, msg: string): void {
    this.onLog?.(level, msg)
  }

  start(): void {
    if (this.timer) return
    this.log('info', 'Scheduler started')
    this.tick()
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.log('info', 'Scheduler stopped')
    }
  }

  get isRunning(): boolean {
    return this.timer !== null
  }

  private async tick(): Promise<void> {
    const taskNames = await this.store.listTasks()
    this.log('debug', `Checking ${taskNames.length} task(s)`)

    for (const name of taskNames) {
      if (this.running.size >= this.concurrency) break
      if (this.running.has(name)) continue

      try {
        const info = await this.store.getTaskInfo(name)
        const schedule = info.config.schedule

        if (schedule.type !== 'cron') continue

        const lastRunDate = info.lastRun ? new Date(info.lastRun) : null

        if (shouldRunNow(schedule.expr, lastRunDate, schedule.timezone)) {
          this.log('info', `Triggering task: ${name}`)
          await this.runTask(name, info)
        }
      } catch (err) {
        this.log('error', `Error checking task ${name}: ${String(err)}`)
      }
    }
  }

  private async runTask(name: string, info: TaskInfo): Promise<void> {
    const { config } = info
    const maxRetries = config.execution.retry?.max ?? 0
    const retryDelay = config.execution.retry?.delay ?? 60

    this.running.add(name)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await executeTask({
          taskDir: info.dir,
          config,
          opencodeBin: this.opencodeBin,
        })

        const history = await this.store.getHistory(name)
        history.push(result.record)
        await this.store.saveHistory(name, history)

        if (result.record.status === 'success') {
          this.log('info', `Task ${name} completed successfully`)
          break
        } else {
          this.log(
            'warn',
            `Task ${name} attempt ${attempt + 1}/${maxRetries + 1} failed: ${result.record.error}`,
          )
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, retryDelay * 1000))
          }
        }
      } catch (err) {
        this.log('error', `Task ${name} error: ${String(err)}`)
      }
    }

    this.running.delete(name)
  }
}
