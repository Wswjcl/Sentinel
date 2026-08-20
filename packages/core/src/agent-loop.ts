import { executeTask } from './executor.js'
import type { ExecutorOptions, ExecutionResult } from './executor.js'
import { runVerification } from './verification.js'
import { sentinelEvents } from './events.js'
import type { TaskConfig, TaskRunRecord } from './types.js'
import type { VerificationResult } from './verification.js'

// ─── Agent Loop Options ─────────────────────────────────────

export interface AgentLoopOptions {
  taskDir: string
  config: TaskConfig
  opencodeBin?: string
  /** Session continuity for iteration 0, resolved by the runner from the
   *  task's run history (execution.session mode). Fix iterations always
   *  fork from the previous iteration's session so the agent remembers
   *  what it already tried. */
  initialContinueSession?: { sessionId: string; fork: boolean }
  /** Logger callback (reuses scheduler's logger) */
  onLog?: (level: string, msg: string) => void
  /** Replace the CLI executor (desktop serve runtime). */
  executeOverride?: (options: ExecutorOptions) => Promise<ExecutionResult>
  /** Called after each iteration's record is finalized. Use to persist
   *  records incrementally so a crash mid-loop doesn't lose completed
   *  iterations. */
  onIterationComplete?: (record: TaskRunRecord) => void | Promise<void>
  /** Called for each failed iteration when onFailure is 'notify'.
   *  Wire this to the Notifier to actually dispatch intermediate
   *  failure webhooks. */
  onNotifyIterationFailed?: (
    iteration: number,
    verification: VerificationResult,
  ) => void | Promise<void>
}

// ─── Agent Loop Result ──────────────────────────────────────

export interface AgentLoopResult {
  /** Whether the loop converged (verification passed within maxIterations) */
  success: boolean
  /** Total iteration rounds executed */
  iterations: number
  /** All execution records from every iteration */
  records: TaskRunRecord[]
  /** Verification result from the final iteration */
  finalVerification?: VerificationResult
}

// ─── Default Fix Prompt Template ────────────────────────────

const DEFAULT_FIX_PROMPT_TEMPLATE = `上一次执行的验证未通过。

## 原始任务
{originalPrompt}

## 验证反馈
{verification}

## 上次输出摘要
{output}

请根据验证反馈修复问题并重新执行。确保输出满足所有验证标准。`

// ─── Agent Loop Engine ──────────────────────────────────────

/**
 * Run the Agent Loop: execute → verify → fix → iterate.
 *
 * This is the core of Loop Engineering — instead of running a task once
 * and hoping it works, we verify the output and let the agent fix its
 * own mistakes in a controlled loop.
 *
 * The loop is bounded by maxIterations to prevent infinite loops.
 * Each iteration's record is preserved for debugging and auditing.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    taskDir,
    config,
    opencodeBin = 'opencode',
    onLog,
    onIterationComplete,
    onNotifyIterationFailed,
    initialContinueSession,
    executeOverride,
  } = options
  const execute = executeOverride ?? executeTask
  const loopConfig = config.agentLoop
  if (!loopConfig) {
    throw new Error('runAgentLoop: config.agentLoop is required (set agentLoop.enabled: true)')
  }
  const maxIterations = loopConfig.maxIterations ?? 3
  const maxTotalMs =
    loopConfig.maxTotalSeconds != null ? loopConfig.maxTotalSeconds * 1000 : null
  const loopStartedAt = Date.now()

  let currentPrompt = config.execution.prompt
  let lastOutput = ''
  let continueSession = initialContinueSession
  const allRecords: TaskRunRecord[] = []

  onLog?.('info', `Agent Loop started (max ${maxIterations} iterations)`)

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ── 0. Budget guard: stop starting new iterations once the
    // wall-clock budget is exhausted (cost control) ──
    if (maxTotalMs !== null && Date.now() - loopStartedAt > maxTotalMs) {
      onLog?.('warn', `Agent Loop wall-clock budget of ${loopConfig.maxTotalSeconds}s exceeded, stopping`)
      break
    }

    // ── 1. Emit iteration-started event ──
    sentinelEvents.emit('loop:iteration-started', {
      name: config.name,
      iteration,
    })
    onLog?.('info', `Loop iteration ${iteration + 1}/${maxIterations}`)

    // ── 2. Execute OpenCode with current prompt ──
    const result = await execute({
      taskDir,
      config,
      opencodeBin,
      promptOverride: currentPrompt,
      continueSession,
    })
    // Fix iterations fork from this run's session: the agent keeps its
    // context of what was already attempted, while the audit trail of
    // each iteration stays a separate session.
    if (result.record.sessionId) {
      continueSession = { sessionId: result.record.sessionId, fork: true }
    }

    // Clean digest (assistant text + tool trace) - raw stdout is a JSON
    // event blob and makes poor prompt material.
    lastOutput = result.summary

    // ── 3. Verify ONLY if the execution itself succeeded (fail-closed).
    // A crashed execution must never be verified against stale state -
    // a file-existence check would pass on output left over from a
    // previous run and mark the task falsely successful. ──
    let verification: VerificationResult
    if (result.record.status !== 'success') {
      verification = {
        passed: false,
        message: `Execution failed (exit code ${result.record.exitCode ?? -1}): ${result.record.error ?? 'unknown error'}`,
      }
    } else {
      verification = await runVerification({
        type: loopConfig.verification.type,
        command: loopConfig.verification.command,
        criteria: loopConfig.verification.criteria,
        skill: loopConfig.verification.skill,
        taskDir,
        output: result.summary,
        opencodeBin,
        model: config.execution.model,
      })
    }

    // ── 4. Annotate the record with loop metadata ──
    result.record.iteration = iteration
    result.record.verificationPassed = verification.passed
    result.record.verificationOutput = verification.message
    allRecords.push(result.record)

    // Persist this iteration as soon as it completes - a crash or throw
    // in a later iteration must not lose records already paid for.
    await onIterationComplete?.(result.record)

    // ── 5. Emit iteration-completed event ──
    sentinelEvents.emit('loop:iteration-completed', {
      name: config.name,
      iteration,
      passed: verification.passed,
    })

    // ── 6. If verification passed → success! ──
    if (verification.passed) {
      onLog?.('info', `Agent Loop converged after ${iteration + 1} iteration(s)`)
      sentinelEvents.emit('loop:completed', {
        name: config.name,
        success: true,
        iterations: iteration + 1,
      })
      return {
        success: true,
        iterations: iteration + 1,
        records: allRecords,
        finalVerification: verification,
      }
    }

    // ── 7. Verification failed → handle based on onFailure policy ──
    onLog?.('warn', `Iteration ${iteration + 1} verification failed: ${verification.message}`)

    sentinelEvents.emit('loop:verification-failed', {
      name: config.name,
      iteration,
      verification,
    })

    if (loopConfig.verification.onFailure === 'stop') {
      onLog?.('info', 'onFailure=stop, breaking out of loop')
      break
    }

    // 'notify' keeps iterating but dispatches an intermediate failure
    // webhook for each failed iteration (wired by the caller).
    if (loopConfig.verification.onFailure === 'notify') {
      await onNotifyIterationFailed?.(iteration, verification)
    }

    // ── 8. Build fix prompt for next iteration ──
    if (iteration < maxIterations - 1) {
      const fixTemplate = config.execution.fixPromptTemplate ?? DEFAULT_FIX_PROMPT_TEMPLATE
      currentPrompt = fixTemplate
        .replace(/\{originalPrompt\}/g, config.execution.prompt)
        .replace(/\{verification\}/g, verification.message)
        .replace(/\{output\}/g, lastOutput.slice(-2000))
    }
  }

  // ── Loop exhausted without convergence ──
  onLog?.('warn', `Agent Loop exhausted ${maxIterations} iteration(s) without convergence`)
  sentinelEvents.emit('loop:completed', {
    name: config.name,
    success: false,
    iterations: allRecords.length,
  })

  return {
    success: false,
    iterations: allRecords.length,
    records: allRecords,
    finalVerification: allRecords.length > 0
      ? { passed: false, message: allRecords[allRecords.length - 1].verificationOutput ?? 'Loop exhausted' }
      : undefined,
  }
}
