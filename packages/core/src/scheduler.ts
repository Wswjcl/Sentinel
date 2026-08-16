import { randomUUID } from 'node:crypto'
import { TaskStore } from './task-store.js'
import { executeTask } from './executor.js'
import { runAgentLoop } from './agent-loop.js'
import { shouldRunNow, shouldRunInterval } from './cron.js'
import { sentinelEvents } from './events.js'
import { Notifier } from './notifier.js'
import type { TaskInfo, TaskRunRecord, TaskStatus } from './types.js'

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
  private notifier: Notifier

  constructor(options: SchedulerOptions) {
    this.store = options.taskStore
    this.concurrency = options.concurrency ?? 3
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000
    this.opencodeBin = options.opencodeBin ?? 'opencode'
    this.notifier = new Notifier({
      onLog: (level, msg) => this.log(level, msg),
    })
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
    const { config } = info
    const maxRetries = config.execution.retry?.max ?? 0
    const retryDelay = config.execution.retry?.delay ?? 60

    this.running.add(name)

    // Mark status as running
    await this.store.setStatus(name, 'running')
    sentinelEvents.emit('task:status-changed', { name, status: 'running' })

    // ── Agent Loop path (Loop Engineering) ──
    if (config.agentLoop?.enabled) {
      try {
        const loopResult = await runAgentLoop({
          taskDir: info.dir,
          config,
          opencodeBin: this.opencodeBin,
          onLog: (level, msg) => this.log(level, msg),
          // Persist each iteration as soon as it completes so a crash or
          // throw mid-loop doesn't lose records already paid for.
          onIterationComplete: async (record) => {
            const history = await this.store.getHistory(name)
            history.push(record)
            await this.store.saveHistory(name, history)
          },
        })

        if (loopResult.success) {
          const nextStatus = info.config.schedule.type === 'once' ? 'archived' : 'scheduled'
          await this.store.setStatus(name, nextStatus)
          sentinelEvents.emit('task:status-changed', { name, status: nextStatus })
          this.log('info', `Task ${name} loop completed successfully (${loopResult.iterations} iteration(s))`)
          // Notify with the last record
          const lastRecord = loopResult.records[loopResult.records.length - 1]
          if (lastRecord) {
            sentinelEvents.emit('task:run-completed', { name, record: lastRecord })
            await this.notifier.notifyIfNeeded(config, lastRecord)
          }
        } else {
          await this.store.setStatus(name, 'failed')
          sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
          this.log('warn', `Task ${name} loop exhausted ${loopResult.iterations} iteration(s) without convergence`)
          const lastRecord = loopResult.records[loopResult.records.length - 1]
          if (lastRecord) {
            sentinelEvents.emit('task:run-completed', { name, record: lastRecord })
            await this.notifier.notifyIfNeeded(config, lastRecord)
          }
        }
      } catch (err) {
        this.log('error', `Task ${name} agent loop error: ${String(err)}`)
        // Leave a trace in history - a silent failed status with no record
        // makes mid-loop crashes undebuggable. (Records of iterations that
        // completed before the throw were already persisted by the
        // onIterationComplete callback.)
        try {
          const failRecord: TaskRunRecord = {
            id: randomUUID(),
            taskName: name,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: 'failed',
            error: `Agent loop error: ${String(err)}`,
          }
          const history = await this.store.getHistory(name)
          history.push(failRecord)
          await this.store.saveHistory(name, history)
        } catch {}
        await this.store.setStatus(name, 'failed')
        sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
      }

      this.running.delete(name)
      return
    }

    // ── Standard execution path (no Agent Loop) ──
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await executeTask({
          taskDir: info.dir,
          config,
          opencodeBin: this.opencodeBin,
        })

        // Record EVERY attempt in history (not just the last one)
        const history = await this.store.getHistory(name)
        history.push(result.record)
        await this.store.saveHistory(name, history)

        if (result.record.status === 'success') {
          // Auto-archive one-shot tasks after successful execution
          const nextStatus = info.config.schedule.type === 'once' ? 'archived' : 'scheduled'
          await this.store.setStatus(name, nextStatus)
          sentinelEvents.emit('task:run-completed', { name, record: result.record })
          sentinelEvents.emit('task:status-changed', { name, status: nextStatus })
          this.log('info', `Task ${name} completed successfully`)
          // Send webhook notification if configured
          await this.notifier.notifyIfNeeded(config, result.record)
          break
        } else {
          sentinelEvents.emit('task:run-completed', { name, record: result.record })
          this.log(
            'warn',
            `Task ${name} attempt ${attempt + 1}/${maxRetries + 1} failed: ${result.record.error}`,
          )
          if (attempt < maxRetries) {
            await this.store.setStatus(name, 'failed')
            sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
            await new Promise((r) => setTimeout(r, retryDelay * 1000))
            await this.store.setStatus(name, 'running')
            sentinelEvents.emit('task:status-changed', { name, status: 'running' })
          }
        }
      } catch (err) {
        this.log('error', `Task ${name} error: ${String(err)}`)
        // Record the error in history - an exception thrown by executeTask
        // itself would otherwise leave no trace of the failed attempt.
        try {
          const failRecord: TaskRunRecord = {
            id: randomUUID(),
            taskName: name,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            status: 'failed',
            error: String(err),
          }
          const history = await this.store.getHistory(name)
          history.push(failRecord)
          await this.store.saveHistory(name, history)
        } catch {}
        const failStatus: TaskStatus = 'failed'
        await this.store.setStatus(name, failStatus)
        sentinelEvents.emit('task:status-changed', { name, status: failStatus })
      }
    }

    // Final status if all retries exhausted and still not success
    const finalInfo = await this.store.getTaskInfo(name)
    if (finalInfo.status === 'running') {
      await this.store.setStatus(name, 'failed')
      sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
      // Notify on final failure
      await this.notifier.notifyIfNeeded(config, {
        id: '',
        taskName: name,
        startedAt: new Date().toISOString(),
        status: 'failed',
        error: 'All retry attempts exhausted',
      })
    }

    this.running.delete(name)
  }
}
