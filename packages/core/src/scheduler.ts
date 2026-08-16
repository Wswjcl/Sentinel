import { TaskStore } from './task-store.js'
import { runTaskExecution } from './runner.js'
import { shouldRunNow, shouldRunInterval } from './cron.js'
import { sentinelEvents } from './events.js'
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
    sentinelEvents.emit('scheduler:log', { level, msg })
  }

  start(): void {
    if (this.timer) return
    this.log('info', 'Scheduler started')
    sentinelEvents.emit('scheduler:started')
    this.tick()
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.log('info', 'Scheduler stopped')
      sentinelEvents.emit('scheduler:stopped')
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

        // Skip paused and archived tasks
        if (info.status === 'paused' || info.status === 'archived') continue

        let shouldRun = false

        if (schedule.type === 'cron') {
          const lastRunDate = info.lastRun ? new Date(info.lastRun) : null
          shouldRun = shouldRunNow(schedule.expr, lastRunDate, schedule.timezone)
        } else if (schedule.type === 'interval') {
          const lastRunDate = info.lastRun ? new Date(info.lastRun) : null
          shouldRun = shouldRunInterval(schedule.expr, lastRunDate)
        } else if (schedule.type === 'once') {
          // Run once if never run before, then auto-archive
          if (!info.lastRun) {
            shouldRun = true
          }
        }

        if (shouldRun) {
          this.log('info', `Triggering task: ${name} (${schedule.type})`)
          await this.runTask(name, info)
        }
      } catch (err) {
        this.log('error', `Error checking task ${name}: ${String(err)}`)
      }
    }
  }

  private async runTask(name: string, info: TaskInfo): Promise<void> {
    this.running.add(name)

    // Mark status as running
    await this.store.setStatus(name, 'running')
    sentinelEvents.emit('task:status-changed', { name, status: 'running' })

    // Execution, per-iteration history persistence, status transitions
    // and webhook notifications all happen in the shared runner, so
    // scheduled runs, manual runs and `sentinel run` behave identically.
    try {
      await runTaskExecution({
        taskStore: this.store,
        name,
        info,
        opencodeBin: this.opencodeBin,
        onLog: (level, msg) => this.log(level, msg),
      })
    } finally {
      this.running.delete(name)
    }
  }
}
