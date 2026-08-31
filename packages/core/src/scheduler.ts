import { TaskStore } from './task-store.js'
import { FlowStore } from './flow-store.js'
import { FlowEngine } from './flow.js'
import { runTaskExecution } from './runner.js'
import type { ExecutorOptions, ExecutionResult } from './executor.js'
import { shouldRunNow, shouldRunInterval, shouldRunAt } from './cron.js'
import { sentinelEvents } from './events.js'
import type { TaskInfo } from './types.js'

export interface SchedulerOptions {
  taskStore: TaskStore
  /** When provided, flows with a schedule are triggered too. */
  flowStore?: FlowStore
  concurrency?: number
  checkIntervalMs?: number
  opencodeBin?: string
  /** Replace the CLI executor for scheduled runs AND flow AI nodes
   *  (desktop app routes both through the opencode serve runtime when
   *  the user selects serve mode). */
  executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
}

export class Scheduler {
  private store: TaskStore
  private flowStore?: FlowStore
  private flowEngine?: FlowEngine
  private concurrency: number
  private checkIntervalMs: number
  private opencodeBin: string
  private executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  private onLog?: (level: string, msg: string) => void

  constructor(options: SchedulerOptions) {
    this.store = options.taskStore
    this.flowStore = options.flowStore
    this.concurrency = options.concurrency ?? 3
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000
    this.opencodeBin = options.opencodeBin ?? 'opencode'
    this.executeOverride = options.executeOverride
    if (this.flowStore) {
      this.flowEngine = new FlowEngine({
        flowStore: this.flowStore,
        taskStore: this.store,
        opencodeBin: this.opencodeBin,
        concurrency: this.concurrency,
        executeOverride: this.executeOverride,
        onLog: (level, msg) => this.log(level, msg),
      })
    }
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
        } else if (schedule.type === 'at') {
          shouldRun = shouldRunAt(
            schedule.expr,
            schedule.interval,
            info.lastRun ? new Date(info.lastRun) : null,
            info.runCount,
            schedule.maxRuns,
          )
        }

        if (shouldRun) {
          this.log('info', `Triggering task: ${name} (${schedule.type})`)
          await this.runTask(name, info)
        }
      } catch (err) {
        this.log('error', `Error checking task ${name}: ${String(err)}`)
      }
    }

    if (this.flowStore && this.flowEngine) {
      await this.tickFlows()
    }
  }

  /** Trigger flows whose whole-flow schedule is due. */
  private async tickFlows(): Promise<void> {
    const flowNames = await this.flowStore!.listFlows()

    for (const fname of flowNames) {
      const key = `flow:${fname}`
      if (this.running.has(key)) continue

      try {
        const config = await this.flowStore!.getConfig(fname)
        if (!config.schedule) continue

        const runs = await this.flowStore!.getRuns(fname)
        const lastRun = runs.length > 0 ? runs[runs.length - 1].startedAt : undefined
        const schedule = config.schedule

        let shouldRun = false
        if (schedule.type === 'cron') {
          shouldRun = shouldRunNow(schedule.expr, lastRun ? new Date(lastRun) : null, schedule.timezone)
        } else if (schedule.type === 'interval') {
          shouldRun = shouldRunInterval(schedule.expr, lastRun ? new Date(lastRun) : null)
        } else if (schedule.type === 'once') {
          shouldRun = !lastRun
        } else if (schedule.type === 'at') {
          shouldRun = shouldRunAt(
            schedule.expr,
            schedule.interval,
            lastRun ? new Date(lastRun) : null,
            runs.length,
            schedule.maxRuns,
          )
        }

        if (shouldRun) {
          this.log('info', `Triggering flow: ${fname} (${schedule.type})`)
          this.running.add(key)
          this.flowEngine!.run(fname).catch((err) => {
            this.log('error', `Flow ${fname} error: ${String(err)}`)
          }).finally(() => {
            this.running.delete(key)
          })
        }
      } catch (err) {
        this.log('error', `Error checking flow ${fname}: ${String(err)}`)
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
        executeOverride: this.executeOverride,
        onLog: (level, msg) => this.log(level, msg),
      })
    } finally {
      this.running.delete(name)
    }
  }
}
