import { randomUUID } from 'node:crypto'
import { executeTask } from './executor.js'
import { runAgentLoop } from './agent-loop.js'
import { sentinelEvents } from './events.js'
import { Notifier } from './notifier.js'
import type { TaskStore } from './task-store.js'
import type { TaskInfo, TaskRunRecord, TaskStatus } from './types.js'
import type { AgentLoopResult } from './agent-loop.js'

// ─── Runner Options ─────────────────────────────────────────

export interface TaskRunnerOptions {
  taskStore: TaskStore
  name: string
  info: TaskInfo
  opencodeBin?: string
  onLog?: (level: string, msg: string) => void
}

// ─── Runner Result ──────────────────────────────────────────

export interface TaskRunOutcome {
  /** Whether the task (or its agent loop) converged successfully */
  ok: boolean
  /** Final persisted status */
  finalStatus: TaskStatus
  /** Last recorded run record (undefined only if even the error record failed to persist) */
  lastRecord?: TaskRunRecord
  /** Full agent-loop result when the task ran with agentLoop enabled */
  loopResult?: AgentLoopResult
}

/**
 * Execute a single task run - the ONE shared execution path for
 * scheduled runs, manual runs from the desktop app, and `sentinel run`.
 *
 * Handles both execution modes with identical semantics:
 * - Agent Loop (agentLoop.enabled): execute -> verify -> fix -> iterate,
 *   records persisted per iteration, intermediate failure notices on
 *   onFailure: 'notify'
 * - Standard: bounded retries with delay, every attempt recorded
 *
 * Status transitions, history persistence, and webhook notifications
 * are all handled here so every entry point behaves the same.
 * The caller is responsible for marking the task 'running' beforehand
 * and for concurrency bookkeeping.
 */
export async function runTaskExecution(
  options: TaskRunnerOptions,
): Promise<TaskRunOutcome> {
  const { taskStore, name, info, opencodeBin = 'opencode', onLog } = options
  const { config } = info

  const log = (level: string, msg: string): void => onLog?.(level, msg)
  const notifier = new Notifier({ onLog: (level, msg) => log(level, msg) })

  // ── Agent Loop path (Loop Engineering) ──
  if (config.agentLoop?.enabled) {
    try {
      const loopResult = await runAgentLoop({
        taskDir: info.dir,
        config,
        opencodeBin,
        onLog: log,
        // Persist each iteration as soon as it completes so a crash or
        // throw mid-loop doesn't lose records already paid for.
        onIterationComplete: async (record) => {
          const history = await taskStore.getHistory(name)
          history.push(record)
          await taskStore.saveHistory(name, history)
        },
        onNotifyIterationFailed: async (iteration, verification) => {
          await notifier.notifyLoopIterationFailed(config, iteration, verification)
        },
      })

      const lastRecord = loopResult.records[loopResult.records.length - 1]
      const finalStatus: TaskStatus = loopResult.success
        ? (config.schedule.type === 'once' ? 'archived' : 'scheduled')
        : 'failed'
      await taskStore.setStatus(name, finalStatus)
      sentinelEvents.emit('task:status-changed', { name, status: finalStatus })
      if (lastRecord) {
        sentinelEvents.emit('task:run-completed', { name, record: lastRecord })
        await notifier.notifyIfNeeded(config, lastRecord)
      }
      log(
        loopResult.success ? 'info' : 'warn',
        `Task ${name} loop ${loopResult.success ? 'completed successfully' : `exhausted after ${loopResult.iterations} iteration(s) without convergence`} (${loopResult.iterations} iteration(s))`,
      )
      return { ok: loopResult.success, finalStatus, lastRecord, loopResult }
    } catch (err) {
      log('error', `Task ${name} agent loop error: ${String(err)}`)
      // Leave a trace in history - a silent failed status with no record
      // makes mid-loop crashes undebuggable. (Records of iterations that
      // completed before the throw were already persisted by the
      // onIterationComplete callback.)
      const failRecord: TaskRunRecord = {
        id: randomUUID(),
        taskName: name,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: `Agent loop error: ${String(err)}`,
      }
      try {
        const history = await taskStore.getHistory(name)
        history.push(failRecord)
        await taskStore.saveHistory(name, history)
        await taskStore.setStatus(name, 'failed')
        sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
      } catch {}
      return { ok: false, finalStatus: 'failed', lastRecord: failRecord }
    }
  }

  // ── Standard execution path (no Agent Loop) ──
  const maxRetries = config.execution.retry?.max ?? 0
  const retryDelay = config.execution.retry?.delay ?? 60
  let lastRecord: TaskRunRecord | undefined
  let finalStatus: TaskStatus = 'failed'

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeTask({
        taskDir: info.dir,
        config,
        opencodeBin,
      })
      lastRecord = result.record

      // Record EVERY attempt in history (not just the last one)
      const history = await taskStore.getHistory(name)
      history.push(result.record)
      await taskStore.saveHistory(name, history)

      if (result.record.status === 'success') {
        // Auto-archive one-shot tasks after successful execution
        finalStatus = config.schedule.type === 'once' ? 'archived' : 'scheduled'
        await taskStore.setStatus(name, finalStatus)
        sentinelEvents.emit('task:run-completed', { name, record: result.record })
        sentinelEvents.emit('task:status-changed', { name, status: finalStatus })
        log('info', `Task ${name} completed successfully`)
        // Send webhook notification if configured
        await notifier.notifyIfNeeded(config, result.record)
        break
      } else {
        sentinelEvents.emit('task:run-completed', { name, record: result.record })
        log(
          'warn',
          `Task ${name} attempt ${attempt + 1}/${maxRetries + 1} failed: ${result.record.error}`,
        )
        if (attempt < maxRetries) {
          await taskStore.setStatus(name, 'failed')
          sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
          await new Promise((r) => setTimeout(r, retryDelay * 1000))
          await taskStore.setStatus(name, 'running')
          sentinelEvents.emit('task:status-changed', { name, status: 'running' })
        }
      }
    } catch (err) {
      log('error', `Task ${name} error: ${String(err)}`)
      // Record the error in history - an exception thrown by executeTask
      // itself would otherwise leave no trace of the failed attempt.
      const failRecord: TaskRunRecord = {
        id: randomUUID(),
        taskName: name,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'failed',
        error: String(err),
      }
      lastRecord = failRecord
      try {
        const history = await taskStore.getHistory(name)
        history.push(failRecord)
        await taskStore.saveHistory(name, history)
      } catch {}
    }
  }

  if (finalStatus !== 'archived' && finalStatus !== 'scheduled') {
    await taskStore.setStatus(name, 'failed')
    sentinelEvents.emit('task:status-changed', { name, status: 'failed' })
    finalStatus = 'failed'
    // Notify on final failure
    await notifier.notifyIfNeeded(config, lastRecord ?? {
      id: '',
      taskName: name,
      startedAt: new Date().toISOString(),
      status: 'failed',
      error: 'All retry attempts exhausted',
    })
  }

  return { ok: finalStatus !== 'failed', finalStatus, lastRecord }
}
