import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AnthropicMessagesRequest, OpenAIChatChunk } from './types.js'
import {
  StreamTranslator,
  anthropicToOpenAIRequest,
  estimateInputTokens,
  openAIToAnthropicResponse,
} from './translate.js'

/**
 * Local protocol gateway: exposes an Anthropic Messages API on
 * 127.0.0.1 and forwards every request to ONE OpenAI-compatible
 * upstream. Claude Code (via the Agent SDK) points ANTHROPIC_BASE_URL
 * at this server; the provider's API key never leaves Sentinel - the
 * subprocess only ever sees the loopback URL.
 *
 * One gateway instance serves one provider binding. Runs are cheap to
 * start (an http.Server on an ephemeral port), so the scheduler can
 * spin one up per claude-runtime execution and stop it afterwards.
 */

export interface GatewayOptions {
  /** Upstream OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1 */
  baseUrl: string
  /** Upstream API key, sent as Authorization: Bearer */
  apiKey: string
  /** Extra headers for the upstream (e.g. HTTP-Referer for openrouter). */
  extraHeaders?: Record<string, string>
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

function anthropicError(status: number, message: string): { status: number; body: { type: 'error'; error: { type: string; message: string } } } {
  const type =
    status === 400 ? 'invalid_request_error'
    : status === 401 ? 'authentication_error'
    : status === 403 ? 'permission_error'
    : status === 404 ? 'not_found_error'
    : status === 429 ? 'rate_limit_error'
    : status === 529 ? 'overloaded_error'
    : 'api_error'
  return { status, body: { type: 'error', error: { type, message } } }
}

export class ProtocolGateway {
  private readonly options: GatewayOptions
  private server: http.Server | null = null

  constructor(options: GatewayOptions) {
    this.options = options
  }

  /** Bind on 127.0.0.1 and return the assigned port. */
  async start(): Promise<number> {
    const server = http.createServer((req, res) => {
      void this.handle(req, res)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    this.options.onLog?.('info', `[gateway] anthropic→openai gateway listening on 127.0.0.1:${port} → ${this.options.baseUrl}`)
    return port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.options.onLog?.('info', '[gateway] stopped')
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'HEAD' && url.pathname === '/api/hello') {
        res.writeHead(200).end()
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/hello') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        await this.proxyModels(res)
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
        const body = (await readJson(req)) as AnthropicMessagesRequest
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: estimateInputTokens(body) }))
        return
      }
      if (req.method === 'POST' && (url.pathname === '/v1/messages' || url.pathname === '/v1/messages:beta')) {
        const body = (await readJson(req)) as AnthropicMessagesRequest
        await this.forwardMessages(body, req, res)
        return
      }
      const err = anthropicError(404, `unknown path: ${req.method} ${url.pathname}`)
      res.writeHead(err.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(err.body))
    } catch (err) {
      this.options.onLog?.('error', `[gateway] request failed: ${String(err)}`)
      if (!res.headersSent) {
        const e = anthropicError(500, String(err))
        res.writeHead(e.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(e.body))
      } else {
        res.end()
      }
    }
  }

  private upstreamHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.options.apiKey}`,
      ...this.options.extraHeaders,
    }
  }

  private async proxyModels(res: http.ServerResponse): Promise<void> {
    const base = this.options.baseUrl.replace(/\/+$/, '')
    const up = await fetch(`${base}/models`, { headers: this.upstreamHeaders() })
    const text = await up.text()
    res.writeHead(up.status, { 'content-type': 'application/json' })
    res.end(text)
  }

  private async forwardMessages(
    body: AnthropicMessagesRequest,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const upstreamReq = anthropicToOpenAIRequest(body)
    const base = this.options.baseUrl.replace(/\/+$/, '')
    const abort = new AbortController()
    // If the SDK client hangs up mid-run, stop the upstream too.
    req.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })

    const up = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: this.upstreamHeaders(),
      body: JSON.stringify(upstreamReq),
      signal: abort.signal,
    })

    if (!up.ok) {
      const text = await up.text().catch(() => '')
      let message = text.slice(0, 2000)
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } }
        if (parsed?.error?.message) message = parsed.error.message
      } catch { /* keep raw text */ }
      const e = anthropicError(up.status === 529 ? 529 : up.status >= 500 ? 500 : up.status, message || `upstream ${up.status}`)
      this.options.onLog?.('warn', `[gateway] upstream ${up.status}: ${message.slice(0, 200)}`)
      res.writeHead(e.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(e.body))
      return
    }

    if (!body.stream) {
      const json = (await up.json()) as Parameters<typeof openAIToAnthropicResponse>[0]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(openAIToAnthropicResponse(json, body.model)))
      return
    }

    // Streaming: translate OpenAI data:-chunks into Anthropic SSE frames.
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(new StreamTranslator(body.model).start())

    const translator = new StreamTranslator(body.model)
    let lastFinishReason: string | null = null
    let buffer = ''
    try {
      for await (const raw of up.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += new TextDecoder().decode(raw, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, sep).trim()
          buffer = buffer.slice(sep + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          const chunk = JSON.parse(data) as OpenAIChatChunk
          const frame = translator.push(chunk)
          if (frame) writeFrame(res, frame)
          for (const choice of chunk.choices ?? []) {
            if (choice.finish_reason) lastFinishReason = choice.finish_reason
          }
        }
      }
      writeFrame(res, translator.finish(lastFinishReason))
      res.end()
    } catch (err) {
      this.options.onLog?.('warn', `[gateway] stream interrupted: ${String(err)}`)
      // Terminate the Anthropic stream with an explicit `error` event:
      // closing with a normal message_stop would make the client read a
      // truncated stream as a successful (usually empty) completion.
      // A client hang-up (the abort source) has res destroyed - skip.
      if (!res.writableEnded && !res.destroyed) {
        writeFrame(res, streamErrorFrame(`upstream stream interrupted: ${String(err)}`))
        res.end()
      }
    }
  }
}

function writeFrame(res: http.ServerResponse, frame: string): void {
  if (!res.write(frame)) {
    // Rare on loopback; keep correctness over throughput.
    res.once('drain', () => undefined)
  }
}

/** Terminal Anthropic SSE error event (mid-stream failure). */
function streamErrorFrame(message: string): string {
  return `event: error\ndata: ${JSON.stringify({
    type: 'error',
    error: { type: 'api_error', message },
  })}\n\n`
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8')
        resolve(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
