import http from 'node:http'
import https from 'node:https'
import type { TaskConfig, TaskRunRecord } from './types.js'
import type { VerificationResult } from './verification.js'
import { localDayKey } from './usage.js'

/** Last local day (YYYY-MM-DD) each task sent a budget-exceeded notice. */
const budgetNotifiedDay = new Map<string, string>()

/** Forget budget-notice dedupe state (tests; a fresh process starts clean). */
export function resetBudgetNotifyState(): void {
  budgetNotifiedDay.clear()
}

export interface NotifierOptions {
  /** Called when a webhook dispatch succeeds or fails (for logging) */
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

/**
 * Dispatches webhook notifications based on task config's notify
 * settings. All methods are explicit - callers invoke them at the
 * appropriate points (scheduler, runner, IPC handlers).
 */
export class Notifier {
  private onLog?: NotifierOptions['onLog']

  constructor(options?: NotifierOptions) {
    this.onLog = options?.onLog
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.onLog?.(level, msg)
  }

  /**
   * Check if a notification should be sent for this task result,
   * and dispatch the webhook if configured.
   */
  async notifyIfNeeded(config: TaskConfig, record: TaskRunRecord): Promise<void> {
    const notify = config.notify
    if (!notify?.webhook_url) return

    const isSuccess = record.status === 'success'
    const shouldNotify =
      (isSuccess && notify.on_success === 'webhook') ||
      (!isSuccess && notify.on_failure === 'webhook')

    if (!shouldNotify) return

    const payload = {
      task: config.name,
      status: record.status,
      exitCode: record.exitCode,
      error: record.error || undefined,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt || undefined,
      timestamp: new Date().toISOString(),
    }

    try {
      await this.sendWebhook(notify.webhook_url, payload)
      this.log('info', `Webhook notification sent for task ${config.name} (${record.status})`)
    } catch (err) {
      this.log('warn', `Webhook failed for task ${config.name}: ${String(err)}`)
    }
  }

  /**
   * Dispatch an intermediate failure webhook for an agent-loop iteration
   * (onFailure: 'notify'). Respects the on_failure webhook setting.
   */
  async notifyLoopIterationFailed(
    config: TaskConfig,
    iteration: number,
    verification: VerificationResult,
  ): Promise<void> {
    const notify = config.notify
    if (!notify?.webhook_url || notify.on_failure !== 'webhook') return

    const payload = {
      task: config.name,
      event: 'loop.iteration-failed',
      iteration,
      status: 'failed',
      error: verification.message,
      timestamp: new Date().toISOString(),
    }

    try {
      await this.sendWebhook(notify.webhook_url, payload)
      this.log('info', `Loop iteration ${iteration + 1} failure notice sent for task ${config.name}`)
    } catch (err) {
      this.log('warn', `Loop failure webhook failed for task ${config.name}: ${String(err)}`)
    }
  }

  /**
   * Webhook notice when a task's monthly budget cap blocks a run. Sent
   * whenever a webhook is configured - budget events are neither a run
   * success nor a failure, so the on_success/on_failure flags don't apply.
   *
   * Deduplicated to one notice per task per local day: while the cap holds,
   * every trigger of the schedule re-enters the budget gate, and a cron
   * firing every few minutes would otherwise spam the webhook until the
   * month rolls over.
   */
  async notifyBudgetExceeded(
    config: TaskConfig,
    usage: { cost: number; tokens: number; monthlyCostUsd?: number; monthlyTokens?: number },
  ): Promise<void> {
    const notify = config.notify
    if (!notify?.webhook_url) return
    const today = localDayKey(new Date().toISOString())
    if (budgetNotifiedDay.get(config.name) === today) return
    const reasons: string[] = []
    if (usage.monthlyCostUsd !== undefined) reasons.push(`$${usage.cost.toFixed(4)} >= $${usage.monthlyCostUsd}`)
    if (usage.monthlyTokens !== undefined) reasons.push(`${usage.tokens.toLocaleString()} tokens >= ${usage.monthlyTokens.toLocaleString()}`)
    const payload = {
      task: config.name,
      event: 'budget.exceeded',
      status: 'skipped',
      usage: {
        month_cost_usd: Number(usage.cost.toFixed(6)),
        month_tokens: usage.tokens,
        limit_cost_usd: usage.monthlyCostUsd,
        limit_tokens: usage.monthlyTokens,
      },
      message: `Monthly budget reached: ${reasons.join(', ')}`,
      timestamp: new Date().toISOString(),
    }
    try {
      await this.sendWebhook(notify.webhook_url, payload)
      // Mark only on success - a failed dispatch retries on the next
      // trigger instead of being silenced for the rest of the day.
      budgetNotifiedDay.set(config.name, today)
      this.log('info', `Budget-exceeded webhook sent for task ${config.name}`)
    } catch (err) {
      this.log('warn', `Budget-exceeded webhook failed for task ${config.name}: ${String(err)}`)
    }
  }

  private sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload)
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const mod = isHttps ? https : http

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'Sentinel-Notifier/1.0',
        },
        timeout: 10_000,
      }

      const req = mod.request(options, (res) => {
        res.resume() // drain the response
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`Webhook returned status ${res.statusCode}`))
        }
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Webhook request timed out'))
      })

      req.write(data)
      req.end()
    })
  }
}
