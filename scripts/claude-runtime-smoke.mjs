#!/usr/bin/env node
/**
 * Claude runtime smoke test: the full production chain with a mock
 * OpenAI upstream - Agent SDK (real claude.exe) → local ProtocolGateway
 * (Anthropic→OpenAI translation) → mock upstream. Asserts the SDK query
 * settles successfully, the model's reply round-trips back, the upstream
 * sees the gateway's Bearer key (never the CLI's), and usage accounting
 * survives the translation.
 */
import http from 'node:http'
import { rm, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const coreDist = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../packages/core/dist/')
const { ProtocolGateway } = await import(pathToFileURL(join(coreDist, 'gateway/index.js')).href)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`OK   | ${name}`) }
  else { fail++; console.log(`FAIL | ${name}${detail ? ` — ${detail}` : ''}`) }
}

const GUARD = setTimeout(() => {
  console.log('FAIL | overall timeout — claude.exe did not settle in time')
  process.exit(1)
}, 180_000)

// ─── Mock OpenAI upstream ──────────────────────────────────────────

const captured = []
function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

const upstream = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {}
    captured.push({ path: req.url, auth: req.headers.authorization ?? '', body: parsed })

    if (!req.url.includes('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `unexpected path ${req.url}` } }))
      return
    }
    if (!parsed.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-1', model: parsed.model,
        choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(sseChunk({ choices: [{ delta: { role: 'assistant' } }] }))
    res.write(sseChunk({ choices: [{ delta: { content: 'pong' } }] }))
    res.write(sseChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
    res.write(sseChunk({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }))
    res.end('data: [DONE]\n\n')
  })
})

await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upstreamPort = upstream.address().port

// ─── Gateway + isolated Claude home + workspace ────────────────────

const gateway = new ProtocolGateway({
  baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
  apiKey: 'sk-test-upstream-key',
  onLog: (level, msg) => console.log(`[gateway:${level}] ${msg}`),
})
const gatewayPort = await gateway.start()
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`

const root = await mkdtemp(join(tmpdir(), 'sentinel-claude-smoke-'))
const workspace = join(root, 'workspace')
const claudeHome = join(root, 'claude-home')
// The child is spawned with cwd=workspace - like a task dir, it must exist.
await mkdir(workspace, { recursive: true })
await mkdir(claudeHome, { recursive: true })

// ─── Real SDK query through the gateway ────────────────────────────

const sdk = await import('@anthropic-ai/claude-agent-sdk')
const abort = new AbortController()
const abortTimer = setTimeout(() => abort.abort(), 150_000)
const stderrChunks = []

const inherited = { ...process.env }
delete inherited.ANTHROPIC_API_KEY

let resultMessage = null
try {
  const query = sdk.query({
    prompt: 'Reply with exactly: pong',
    options: {
      cwd: workspace,
      model: 'mock-model',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      abortController: abort,
      env: {
        ...inherited,
        ANTHROPIC_BASE_URL: gatewayUrl,
        ANTHROPIC_AUTH_TOKEN: 'sentinel-gateway',
        CLAUDE_CONFIG_DIR: claudeHome,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      stderr: (data) => stderrChunks.push(data),
    },
  })
  for await (const message of query) {
    if (message.type === 'result') resultMessage = message
  }
} catch (err) {
  console.log(`[smoke] query threw: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  clearTimeout(abortTimer)
}

// ─── Assertions ────────────────────────────────────────────────────

check('query returned a result message', resultMessage !== null)
check('result subtype is success', resultMessage?.subtype === 'success')
check('result text round-trips', typeof resultMessage?.result === 'string' && resultMessage.result.includes('pong'),
  JSON.stringify(resultMessage?.result)?.slice(0, 200))
check('session id present', typeof resultMessage?.session_id === 'string' && resultMessage.session_id.length > 0)
const completions = captured.filter((c) => c.path.includes('/chat/completions'))
check('upstream received completions call', completions.length > 0)
check('upstream saw gateway bearer key (not CLI auth)', completions.some((c) => c.auth === 'Bearer sk-test-upstream-key'),
  `saw: ${completions.map((c) => c.auth).join(', ') || 'nothing'}`)
check('model passed through', completions.some((c) => c.body.model === 'mock-model'))
const usageOk =
  resultMessage?.usage?.input_tokens > 0 || resultMessage?.usage?.output_tokens > 0 ||
  Object.keys(resultMessage?.modelUsage ?? {}).length > 0
check('usage accounting present', usageOk)

await gateway.stop()
upstream.close()
await rm(root, { recursive: true, force: true }).catch(() => {})

clearTimeout(GUARD)
console.log(`\n${pass} passed, ${fail} failed${stderrChunks.length ? `\n[cli stderr]\n${stderrChunks.join('').slice(-2000)}` : ''}`)
process.exit(fail === 0 ? 0 : 1)
