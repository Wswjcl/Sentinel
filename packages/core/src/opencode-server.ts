// ─── OpenCode Serve Runtime (R3) ────────────────────────────
//
// A single shared `opencode serve` process executes task runs over its
// HTTP API. Verified against opencode 1.17-1.18:
//
//   POST /session?directory=<dir>            create session bound to a dir
//   POST /session/:id/message?directory=...  blocking prompt; body
//     { model?: {providerID, modelID}, agent?, parts: [{type:'text',text}] }
//     -> { info: {finish, cost, tokens}, parts: [...] } (same part schema
//        as the CLI --format json stream)
//   GET  /event                              global SSE bus stream
//   POST /session/:id/permissions/:perID     { response: 'once'|'always'|'reject' }
//   POST /session/:id/abort                  stop a running session
//
// Permission requests arrive as SSE `permission.asked` events and are
// dispatched to a handler; with no handler they are DENIED (fail-closed
// for unattended scheduled runs - the generated task config allows the
// common tools, so an ask means something unusual).

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { resolveWindowsBinary } from './executor.js'
import { OpenCodeEventParser } from './opencode-events.js'
import { resolveProviderProvenance } from './provider-config.js'
import type { TaskConfig, TaskRunRecord } from './types.js'

// ─── Types ──────────────────────────────────────────────────

export interface PermissionRequest {
  /** Permission request id (per_...) - used to respond */
  id: string
  sessionId: string
  /** Tool asking for permission, e.g. 'bash' */
  permission: string
  /** Matched patterns, e.g. the exact command for bash */
  patterns: string[]
  /** Tool metadata, e.g. { command } */
  metadata: Record<string, unknown>
  /** 'Always allow' patterns the server suggests */
  always: string[]
}

export type PermissionResponse = 'once' | 'always' | 'reject'

/** Live events streamed to the UI while a run is in flight. */
export type ServeLiveEvent =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-start'; tool: string; title?: string }
  | { kind: 'tool-finish'; tool: string; title?: string; status: string }
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'status'; status: string }

export interface ServeRunOptions {
  taskDir: string
  config: TaskConfig
  promptOverride?: string
  continueSession?: { sessionId: string; fork: boolean }
  /** Permission policy. Return a response or a promise of one. Requests
   *  that outlive `permissionTimeoutMs` are denied. Default: deny all. */
  onPermission?: (request: PermissionRequest) => Promise<PermissionResponse> | PermissionResponse
  /** Audit hook: fires once per ask with the final outcome - 'timeout'
   *  means the 2-minute wait elapsed and the ask was auto-denied. */
  onPermissionResult?: (request: PermissionRequest, response: PermissionResponse | 'timeout') => void
  permissionTimeoutMs?: number
  /** Live event stream (text deltas, tool calls, permission asks). */
  onEvent?: (event: ServeLiveEvent) => void
  /** Aborts the run (POST abort) and fails the record. */
  abortSignal?: AbortSignal
}

// Reuse the executor's result contract so callers can swap runtimes.
export type { ExecutionResult } from './executor.js'
import type { ExecutionResult } from './executor.js'

interface SseEvent {
  type?: string
  properties?: Record<string, unknown>
}

// ─── Server lifecycle ───────────────────────────────────────

export interface OpenCodeServerOptions {
  opencodeBin?: string
  /** Fixed port; default picks a free ephemeral port. */
  port?: number
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** Audit hook: fires once per permission ask with the final outcome. */
  onPermissionResult?: (request: PermissionRequest, response: PermissionResponse | 'timeout') => void
}

export class OpenCodeServer {
  private proc?: ChildProcess
  private port!: number
  private baseUrl!: string
  /** SSE streams are directory-scoped: /event only pushes events for
   *  sessions in the given directory, so we keep one stream per task dir. */
  private eventStreams = new Map<string, { abort: AbortController; started: Promise<void> }>()
  private onPermissionResult?: (request: PermissionRequest, response: PermissionResponse | 'timeout') => void
  private permissionHandlers = new Map<
    string,
    (request: PermissionRequest) => Promise<PermissionResponse> | PermissionResponse
  >()
  private eventSinks = new Map<string, (event: ServeLiveEvent) => void>()
  private readonly onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
  private readonly opencodeBin: string

  private constructor(options: OpenCodeServerOptions) {
    this.opencodeBin = options.opencodeBin ?? 'opencode'
    this.onLog = options.onLog
    this.onPermissionResult = options.onPermissionResult
  }

  /** Start a serve process and wait until it answers HTTP requests. */
  static async start(options: OpenCodeServerOptions = {}): Promise<OpenCodeServer> {
    const server = new OpenCodeServer(options)
    const port = options.port ?? (await findFreePort())
    const bin =
      process.platform === 'win32' ? resolveWindowsBinary(server.opencodeBin) : server.opencodeBin

    return new Promise((resolve, reject) => {
      const proc = spawn(bin, ['serve', '--port', String(port)], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      server.proc = proc
      let settled = false

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          proc.kill()
          reject(new Error(`opencode serve did not start within 30s (port ${port})`))
        }
      }, 30000)

      const tryReady = async (): Promise<void> => {
        if (settled) return
        try {
          const res = await fetch(`http://127.0.0.1:${port}/session`, {
            signal: AbortSignal.timeout(3000),
          })
          if (res.ok) {
            settled = true
            clearInterval(poll)
            clearTimeout(timeout)
            server.port = port
            server.baseUrl = `http://127.0.0.1:${port}`
            server.onLog?.('info', `opencode serve ready at ${server.baseUrl}`)
            resolve(server)
          }
        } catch {
          // not up yet - keep polling via stdout watcher
        }
      }
      // Poll readiness; the 'listening on' stdout line is the hint that
      // the HTTP server is accepting connections.
      const poll = setInterval(() => { void tryReady() }, 500)
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('listening on')) void tryReady()
      })
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text && !text.includes('OPENCODE_SERVER_PASSWORD')) {
          server.onLog?.('warn', `opencode serve: ${text.slice(0, 300)}`)
        }
      })
      proc.on('exit', (code) => {
        clearInterval(poll)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(`opencode serve exited during startup (code ${code})`))
        } else {
          server.onLog?.('warn', `opencode serve exited (code ${code})`)
        }
      })
      proc.on('error', (err) => {
        clearInterval(poll)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(err)
        }
      })
    })
  }

  get address(): string {
    return this.baseUrl
  }

  /** Stop the serve process and all SSE listeners. */
  async stop(): Promise<void> {
    for (const { abort } of this.eventStreams.values()) abort.abort()
    this.eventStreams.clear()
    this.proc?.kill()
    this.proc = undefined
  }

  /** Ensure an SSE subscription for a directory. Resolves once the
   *  connection is established; the read loop runs in the background. */
  private ensureEventStream(directory: string): Promise<void> {
    const existing = this.eventStreams.get(directory)
    if (existing) return existing.started
    const abort = new AbortController()
    const started = new Promise<void>((resolveConnected) => {
      void (async () => {
        try {
          const res = await fetch(
            `${this.baseUrl}/event?directory=${encodeURIComponent(directory)}`,
            {
              signal: abort.signal,
              headers: { accept: 'text/event-stream' },
            },
          )
          if (!res.ok || !res.body) throw new Error(`SSE /event returned ${res.status}`)
          resolveConnected()
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            // SSE frames may be separated by \n\n or \r\n\r\n - normalize
            // before splitting frames.
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            let idx: number
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              const dataLine = frame
                .split('\n')
                .find((l) => l.startsWith('data: '))
              if (!dataLine) continue
              try {
                this.handleSseEvent(JSON.parse(dataLine.slice(6)) as SseEvent)
              } catch {
                // malformed frame - skip
              }
            }
          }
        } catch (err) {
          // Aborted on stop() is expected; anything else leaves live events
          // silent but execution still works via the blocking message call.
          if (!abort.signal.aborted) {
            this.onLog?.('warn', `SSE event stream ended: ${String(err)}`)
          }
        }
      })()
    })
    this.eventStreams.set(directory, { abort, started })
    return started
  }

  private handleSseEvent(ev: SseEvent): void {
    const props = ev.properties ?? {}
    const sessionId = typeof props.sessionID === 'string' ? props.sessionID : undefined

    if (ev.type === 'permission.asked') {
      const request: PermissionRequest = {
        id: String(props.id ?? ''),
        sessionId: sessionId ?? '',
        permission: String(props.permission ?? 'unknown'),
        patterns: Array.isArray(props.patterns) ? (props.patterns as string[]) : [],
        metadata: (props.metadata as Record<string, unknown>) ?? {},
        always: Array.isArray(props.always) ? (props.always as string[]) : [],
      }
      this.eventSinks.get(request.sessionId)?.({ kind: 'permission', request })
      const handler = this.permissionHandlers.get(request.sessionId)
      if (handler) {
        void this.respondToPermission(request, handler)
      } else {
        // No handler registered (e.g. SSE race) - fail closed.
        void this.postPermission(request.sessionId, request.id, 'reject')
      }
      return
    }

    if (!sessionId) return
    const sink = this.eventSinks.get(sessionId)
    if (!sink) return

    if (ev.type === 'message.part.updated' || ev.type === 'message.part.delta') {
      const part = props.part as Record<string, unknown> | undefined
      if (ev.type === 'message.part.delta') {
        // True deltas only - falling back to the full part text here would
        // duplicate every line (the part.updated branch already emits it).
        const delta = props.delta
        if (typeof delta === 'string' && delta) {
          sink({ kind: part?.type === 'reasoning' ? 'reasoning' : 'text', text: delta })
        }
        return
      }
      if (!part) return
      if (part.type === 'tool') {
        const state = (part.state ?? {}) as Record<string, unknown>
        const status = String(state.status ?? 'unknown')
        const payload = {
          tool: String(part.tool ?? 'unknown'),
          title: typeof state.title === 'string' ? state.title : undefined,
        }
        sink(status === 'completed' || status === 'error'
          ? { kind: 'tool-finish', ...payload, status }
          : { kind: 'tool-start', ...payload })
      } else if (part.type === 'text' && typeof part.text === 'string') {
        sink({ kind: 'text', text: part.text })
      } else if (part.type === 'reasoning' && typeof part.text === 'string') {
        sink({ kind: 'reasoning', text: part.text })
      }
    } else if (ev.type === 'session.status' && typeof props.status === 'string') {
      sink({ kind: 'status', status: props.status })
    }
  }

  private async respondToPermission(
    request: PermissionRequest,
    handler: (request: PermissionRequest) => Promise<PermissionResponse> | PermissionResponse,
  ): Promise<void> {
    try {
      const timeoutMs = 120_000
      const outcome = await Promise.race([
        Promise.resolve(handler(request)),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
      ])
      // Timeout and a thrown handler both deny - report 'timeout' only for
      // the former so the audit trail can tell the two apart.
      const response: PermissionResponse = outcome === 'timeout' ? 'reject' : outcome
      await this.postPermission(request.sessionId, request.id, response)
      this.onPermissionResult?.(request, outcome)
    } catch {
      await this.postPermission(request.sessionId, request.id, 'reject').catch(() => {})
      this.onPermissionResult?.(request, 'reject')
    }
  }

  private async postPermission(
    sessionId: string,
    permissionId: string,
    response: PermissionResponse,
  ): Promise<void> {
    await fetch(
      `${this.baseUrl}/session/${sessionId}/permissions/${permissionId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch((err: unknown) => {
      // The ask stays pending in opencode - the run hangs until abort -
      // so this must be visible, not swallowed.
      this.onLog?.('warn', `Failed to deliver permission response (${response}) for ${permissionId}: ${String(err)}`)
    })
  }

  // ─── Task execution ─────────────────────────────────────

  /** Execute one task run over the serve HTTP API. Returns the same
   *  ExecutionResult contract as executeTask(). */
  async runTask(options: ServeRunOptions): Promise<ExecutionResult> {
    const { taskDir, config, promptOverride } = options
    const exec = config.execution
    const record: TaskRunRecord = {
      id: randomUUID(),
      taskName: config.name,
      startedAt: new Date().toISOString(),
      status: 'running',
    }

    try {
      await this.ensureEventStream(taskDir)

      // Resolve/create the session (fork/continue reuse the parent id).
      let sessionId: string
      if (options.continueSession) {
        sessionId = options.continueSession.sessionId
        if (options.continueSession.fork) {
          const forked = await this.json(`${this.baseUrl}/session/${sessionId}/fork`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(15_000),
          })
          sessionId = forked.id
        }
      } else {
        const created = await this.json(
          `${this.baseUrl}/session?directory=${encodeURIComponent(taskDir)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: config.name }),
            signal: AbortSignal.timeout(15_000),
          },
        )
        sessionId = created.id
      }
      record.sessionId = sessionId

      // Wire live events + permission handling for this session.
      this.eventSinks.set(sessionId, (event) => options.onEvent?.(event))
      if (options.onPermission) {
        this.permissionHandlers.set(sessionId, options.onPermission)
      }

      // Abort wiring.
      const abortController = new AbortController()
      const onAbort = (): void => {
        void fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        }).catch(() => {})
        abortController.abort()
      }
      options.abortSignal?.addEventListener('abort', onAbort, { once: true })

      // Timeout guard: abort the session and fail the record.
      const timeoutMs = (exec.timeout ?? 600) * 1000
      const timer = setTimeout(() => {
        void fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        }).catch(() => {})
      }, timeoutMs)

      const body: Record<string, unknown> = {
        parts: [{ type: 'text', text: promptOverride ?? exec.prompt }],
      }
      if (exec.model?.includes('/')) {
        const [providerID, modelID] = exec.model.split('/')
        body.model = { providerID, modelID }
      }
      if (exec.agent && exec.agent !== 'default') body.agent = exec.agent

      // Provider provenance: workspace .opencode config overrides global;
      // the body.model override (task execution.model) pins the model.
      const bodyModel = body.model as { providerID: string; modelID: string } | undefined
      const provenance = resolveProviderProvenance(
        taskDir,
        bodyModel ? `${bodyModel.providerID}/${bodyModel.modelID}` : undefined,
      )
      if (provenance.provider) record.provider = provenance.provider
      if (provenance.model) record.modelUsed = provenance.model
      if (provenance.endpoint) record.endpoint = provenance.endpoint
      if (provenance.source) record.providerSource = provenance.source

      let response: { info?: Record<string, unknown>; parts?: unknown[] } | undefined
      let runError: string | undefined
      try {
        response = await this.json(
          `${this.baseUrl}/session/${sessionId}/message?directory=${encodeURIComponent(taskDir)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          },
        )
      } catch (err) {
        runError = String(err)
      } finally {
        clearTimeout(timer)
        options.abortSignal?.removeEventListener('abort', onAbort)
        this.eventSinks.delete(sessionId)
        this.permissionHandlers.delete(sessionId)
      }

      record.finishedAt = new Date().toISOString()

      if (options.abortSignal?.aborted) {
        record.status = 'failed'
        record.exitCode = -1
        record.error = 'Run aborted by user'
        return { record, stdout: '', stderr: '', summary: record.error }
      }

      if (!response) {
        record.status = 'failed'
        record.exitCode = -1
        record.error = `Serve message failed: ${runError ?? 'no response'}`
        return { record, stdout: '', stderr: '', summary: record.error }
      }

      // The message POST response only carries the FINAL assistant message.
      // Tool calls live in intermediate messages, so aggregate parts across
      // every message created since this run started.
      const runStartedMs = Date.parse(record.startedAt) - 1000
      const messages = (await this.json(
        `${this.baseUrl}/session/${sessionId}/message?directory=${encodeURIComponent(taskDir)}&limit=100`,
        { signal: AbortSignal.timeout(15_000) },
      )) as Array<{ info?: { time?: { created?: number } }; parts?: unknown[] }>
      const parts: unknown[] = []
      for (const msg of [...messages].sort(
        (a, b) => (a.info?.time?.created ?? 0) - (b.info?.time?.created ?? 0),
      )) {
        if ((msg.info?.time?.created ?? 0) >= runStartedMs) {
          parts.push(...(msg.parts ?? []))
        }
      }

      const summary = OpenCodeEventParser.summarizeParts(parts)
      record.tokens = summary.tokens
      record.cost = summary.cost
      record.steps = summary.steps
      record.toolCalls = summary.toolCalls
      record.output = summary.text || buildToolDigest(summary.toolCalls)

      const finish = String(response.info?.finish ?? '')
      record.status = finish === 'stop' || finish === 'tool-calls' ? 'success' : 'failed'
      record.exitCode = record.status === 'success' ? 0 : 1
      if (record.status === 'failed') {
        record.error = `Run finished with '${finish || 'unknown'}'`
      }
      return {
        record,
        stdout: JSON.stringify(response),
        stderr: '',
        summary: record.output,
      }
    } catch (err) {
      record.finishedAt = new Date().toISOString()
      record.status = 'failed'
      record.exitCode = -1
      record.error = String(err)
      return { record, stdout: '', stderr: '', summary: record.error }
    }
  }

  private async json(url: string, init: RequestInit): Promise<any> {
    const res = await fetch(url, init)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${url.split('?')[0]}: ${text.slice(0, 300)}`)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
}

function buildToolDigest(toolCalls: TaskRunRecord['toolCalls']): string {
  if (!toolCalls || toolCalls.length === 0) return ''
  return ['--- tool calls ---', ...toolCalls.map((c) => `- ${c.tool}${c.title ? `: ${c.title}` : ''}`)].join('\n')
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}
