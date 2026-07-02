import { createRequire } from 'node:module'
import type { TaskConfig, TaskRunRecord } from './types.js'
import { sentinelEvents } from './events.js'

const require = createRequire(import.meta.url)
let http: typeof import('node:http') | undefined
let https: typeof import('node:https') | undefined

try { http = require('node:http') } catch {}
try { https = require('node:https') } catch {}

export interface NotifierOptions {
  /** Called when a webhook dispatch succeeds or fails (for logging) */
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

/**
 * Subscribes to sentinelEvents and dispatches webhook notifications
 * based on task config's notify settings.
 */
export class Notifier {
  private onLog?: NotifierOptions['onLog']

  constructor(options?: NotifierOptions) {
    this.onLog = options?.onLog

    sentinelEvents.on('task:run-completed', (data: { name: string; record: TaskRunRecord }) => {
      this.handleRunCompleted(data.name, data.record).catch((err) => {
        this.log('error', `Notifier error for ${data.name}: ${String(err)}`)
      })
    })
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.onLog?.(level, msg)
  }

  private async handleRunCompleted(name: string, record: TaskRunRecord): Promise<void> {
    // We need to look up the task config to check notify settings.
    // The caller (scheduler or IPC handler) is responsible for providing
    // the config. For now, we emit a dedicated event that consumers can
    // listen to. The actual config lookup + webhook dispatch happens in
    // the scheduler/desktop main process which has access to the TaskStore.
    //
    // This design keeps the Notifier decoupled from TaskStore.
    // Consumers should call `notifyIfNeeded(config, record)` directly.
  }

  /**
   * Check if a notification should be sent for this task result,
   * and dispatch the webhook if configured.
   */
  async notifyIfNeeded(config: TaskConfig, record: TaskRunRecord): Promise<void> {
    const notify = (config as any).notify
    if (!notify || !notify.webhook_url) return

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

  private sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload)
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const mod = isHttps ? https : http

      if (!mod) {
        reject(new Error(`No ${isHttps ? 'https' : 'http'} module available`))
        return
      }

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
