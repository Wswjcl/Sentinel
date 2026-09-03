import { randomUUID } from 'node:crypto'
import { monthToDate } from './usage.js'
import type { UsageRecordish } from './usage.js'
import { executeTask } from './executor.js'
import type { ExecutorOptions, ExecutionResult } from './executor.js'
import { runAgentLoop } from './agent-loop.js'
import { isScheduleExhausted } from './cron.js'
import { sentinelEvents } from './events.js'
import { Notifier } from './notifier.js'
import type { TaskStore } from './task-store.js'
import type { TaskInfo, TaskExecution, TaskRunRecord, TaskStatus } from './types.js'
import type { AgentLoopResult } from './agent-loop.js'

// ─── Runner Options ─────────────────────────────────────────

export interface TaskRunnerOptions {
  taskStore: TaskStore
  name: string
  info: TaskInfo
  opencodeBin?: string
  onLog?: (level: string, msg: string) => void
  /** Replace the CLI executor (e.g. the desktop app routes execution
   *  through the opencode serve runtime for live view / permission
   *  dialogs / abort). Receives the same options executeTask would. */
  executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
}

// ─── Runner Result ──────────────────────────────────────────

/**
 * Resolve the session-continuity argument for executeTask based on
 * execution.session mode and the most recent session id in history.
 * Returns undefined for 'fresh' (or when no prior session exists).
 */
export function resolveContinueSession(
  mode: TaskExecution['session'],
  history: TaskRunRecord[],
): { sessionId: string; fork: boolean } | undefined {
  if (mode !== 'continue' && mode !== 'fork') return undefined
  for (let i = history.length - 1; i >= 0; i--) {
    const sid = history[i].sessionId
    if (sid) return { sessionId: sid, fork: mode === 'fork' }
  }
  return undefined
}

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
  const { taskStore, name, info, opencodeBin = 'opencode', onLog, executeOverride } = options
  const { config } = info
  const execute = executeOverride ?? executeTask

  const log = (level: string, msg: string): void => onLog?.(level, msg)
  const notifier = new Notifier({ onLog: (level, msg) => log(level, msg) })

  // ── Monthly budget gate ──
  // Month-to-date usage is computed from this task's own history, so it
  // covers every run path (scheduled, manual, agent loop) with no extra
  // storage. Applies to ALL runs: a cap that manual clicks could silently
  // bypass would not be a cap.
  const budget = config.budget
  if (budget && (budget.monthlyCostUsd !== undefined || budget.monthlyTokens !== undefined)) {
    const history = info.history ?? (await taskStore.getHistory(name))
    const records: UsageRecordish[] = history.map((r) => ({
      source: name,
      sourceType: 'task',
      startedAt: r.startedAt,
      tokens: r.tokens,
      cost: r.cost,
    }))
    const month = monthToDate(records)
    const overCost = budget.monthlyCostUsd !== undefined && month.cost >= budget.monthlyCostUsd
    const overTokens = budget.monthlyTokens !== undefined && month.tokens >= budget.monthlyTokens
    if (overCost || overTokens) {
      log(
        'warn',
        `[budget] Task ${name} skipped: month-to-date $${month.cost.toFixed(4)} / ${month.tokens.toLocaleString()} tokens reached its cap` +
          ` ($${budget.monthlyCostUsd ?? '-'} / ${budget.monthlyTokens?.toLocaleString() ?? '-'})`,
      )
      await notifier.notifyBudgetExceeded(config, {
        cost: month.cost,
        tokens: month.tokens,
        monthlyCostUsd: budget.monthlyCostUsd,
        monthlyTokens: budget.monthlyTokens,
      })
      // The caller marked the task 'running' before invoking us - restore
      // a sane status so a skipped run doesn't wedge the task.
      const finalStatus: TaskStatus = info.status === 'running' ? 'scheduled' : info.status
      await taskStore.setStatus(name, finalStatus)
      sentinelEvents.emit('task:status-changed', { name, status: finalStatus })
      return { ok: false, finalStatus, lastRecord: undefined }
    }
  }

  // ── Agent Loop path (Loop Engineering) ──
  if (config.agentLoop?.enabled) {
    try {
      const loopResult = await runAgentLoop({
        taskDir: info.dir,
        config,
        opencodeBin,
        onLog: log,
        executeOverride,
        initialContinueSession: resolveContinueSession(
          config.execution.session,
          info.history,
        ),
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
      const runCount = (await taskStore.getHistory(name)).length
      const finalStatus: TaskStatus = loopResult.success
        ? (isScheduleExhausted(config.schedule, runCount) ? 'archived' : 'scheduled')
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
  // Session continuity: start from the last recorded session, then keep
  // tracking the session each attempt actually used.
  let continueSession = resolveContinueSession(config.execution.session, info.history)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await execute({
        taskDir: info.dir,
        config,
        opencodeBin,
        continueSession,
      })
      lastRecord = result.record
      if (result.record.sessionId) {
        continueSession = resolveContinueSession(config.execution.session, [result.record])
      }

      // Record EVERY attempt in history (not just the last one)
      const history = await taskStore.getHistory(name)
      history.push(result.record)
      await taskStore.saveHistory(name, history)

      if (result.record.status === 'success') {
        // Auto-archive one-shot/exhausted schedules after successful execution
        finalStatus = isScheduleExhausted(config.schedule, history.length) ? 'archived' : 'scheduled'
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
