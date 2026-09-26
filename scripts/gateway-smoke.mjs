#!/usr/bin/env node
/**
 * Protocol gateway smoke tests: spin up a mock OpenAI upstream and drive
 * the gateway through non-streaming, streaming (text / tool calls /
 * reasoning), tool-result round-trips, error mapping, token counting
 * and model listing - asserting the Anthropic wire shapes Claude Code
 * will consume.
 */
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const coreDist = process.argv[2] ?? new URL('../packages/core/dist/', import.meta.url).pathname
const { ProtocolGateway } = await import(pathToFileURL(join(coreDist, 'gateway/index.js')).href)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`OK   | ${name}`) }
  else { fail++; console.log(`FAIL | ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ─── Mock OpenAI upstream ──────────────────────────────────────────

let scenario = 'text'
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

    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(404).end('{}')
      return
    }
    if (scenario === 'error') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    if (!parsed.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-1', model: parsed.model,
        choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (obj) => res.write(sseChunk(obj))
    if (scenario === 'stream-text') {
      send({ choices: [{ delta: { role: 'assistant' } }] })
      send({ choices: [{ delta: { content: 'Hello' } }] })
      send({ choices: [{ delta: { content: ' world' } }] })
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })
    } else if (scenario === 'stream-tool') {
      send({ choices: [{ delta: { role: 'assistant' } }] })
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city":' } }] } }] })
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Tokyo","unit":"c"}' } }] } }] })
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      send({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 7 } })
    } else if (scenario === 'stream-reasoning') {
      send({ choices: [{ delta: { reasoning_content: 'thinking hard' } }] })
      send({ choices: [{ delta: { content: 'answer' } }] })
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })
    }
    res.end('data: [DONE]\n\n')
  })
})

await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upstreamPort = upstream.address().port

const gateway = new ProtocolGateway({
  baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
  apiKey: 'sk-mock',
})
const gatewayPort = await gateway.start()
const GW = `http://127.0.0.1:${gatewayPort}`

// ─── Client helpers ────────────────────────────────────────────────

async function postMessages(body) {
  const res = await fetch(`${GW}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

async function postStream(body) {
  const res = await fetch(`${GW}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })
  const text = await res.text()
  const frames = []
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue
    const event = /event: (.+)/.exec(block)?.[1]
    const data = /data: (.+)/s.exec(block)?.[1]
    if (event && data) frames.push({ event, data: JSON.parse(data) })
  }
  return { status: res.status, frames }
}

// ─── 1. Non-streaming: system + user text ──────────────────────────

scenario = 'text'
const r1 = await postMessages({
  model: 'mock-model', max_tokens: 100,
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hi' }],
})
check('non-stream: 200 + message envelope', r1.status === 200 && r1.json.type === 'message' && r1.json.role === 'assistant')
check('non-stream: text content', r1.json.content?.[0]?.type === 'text' && r1.json.content[0].text === 'Hello')
check('non-stream: stop_reason end_turn', r1.json.stop_reason === 'end_turn')
check('non-stream: usage mapped', r1.json.usage?.input_tokens === 12 && r1.json.usage?.output_tokens === 3)
check('non-stream: model echoed', r1.json.model === 'mock-model')
check('upstream: system message first', captured.at(-1).body.messages?.[0]?.role === 'system' && captured.at(-1).body.messages[0].content === 'You are helpful.')
check('upstream: max_tokens mapped', captured.at(-1).body.max_tokens === 100)
check('upstream: bearer auth', captured.at(-1).auth === 'Bearer sk-mock')

// ─── 2. Streaming text ─────────────────────────────────────────────

scenario = 'stream-text'
const r2 = await postStream({
  model: 'mock-model', max_tokens: 50, messages: [{ role: 'user', content: 'Hi' }],
})
const ev2 = r2.frames.map((f) => f.event)
check('stream: starts with message_start', ev2[0] === 'message_start')
check('stream: text block opened', r2.frames.some((f) => f.event === 'content_block_start' && f.data.content_block?.type === 'text' && f.data.index === 0))
const textDeltas = r2.frames.filter((f) => f.event === 'content_block_delta' && f.data.delta?.type === 'text_delta')
check('stream: text deltas concatenate', textDeltas.map((f) => f.data.delta.text).join('') === 'Hello world', JSON.stringify(textDeltas))
check('stream: text block closed', r2.frames.some((f) => f.event === 'content_block_stop' && f.data.index === 0))
const msgDelta = r2.frames.find((f) => f.event === 'message_delta')
check('stream: message_delta stop_reason + usage', msgDelta?.data.delta?.stop_reason === 'end_turn' && msgDelta.data.usage?.input_tokens === 12 && msgDelta.data.usage?.output_tokens === 3)
check('stream: ends with message_stop', ev2.at(-1) === 'message_stop')
check('stream: stream_options.include_usage sent upstream', captured.at(-1).body.stream_options?.include_usage === true)

// ─── 3. Streaming tool call ────────────────────────────────────────

scenario = 'stream-tool'
const r3 = await postStream({
  model: 'mock-model', max_tokens: 50,
  messages: [{ role: 'user', content: 'weather in Tokyo?' }],
  tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
})
const toolStart = r3.frames.find((f) => f.event === 'content_block_start' && f.data.content_block?.type === 'tool_use')
check('stream tool: block opened with id+name', toolStart?.data.content_block?.id === 'call_1' && toolStart.data.content_block.name === 'get_weather')
const jsonParts = r3.frames.filter((f) => f.event === 'content_block_delta' && f.data.delta?.type === 'input_json_delta')
const assembled = jsonParts.map((f) => f.data.delta.partial_json).join('')
let toolInput = null
try { toolInput = JSON.parse(assembled) } catch {}
check('stream tool: input_json_delta assembles to valid JSON', toolInput?.city === 'Tokyo' && toolInput?.unit === 'c', assembled)
check('stream tool: stop_reason is tool_use', r3.frames.find((f) => f.event === 'message_delta')?.data.delta?.stop_reason === 'tool_use')
check('upstream: tools translated to function schema', captured.at(-1).body.tools?.[0]?.type === 'function' && captured.at(-1).body.tools[0].function?.name === 'get_weather')

// ─── 4. Tool-result round-trip (agent loop continuity) ─────────────

scenario = 'text'
const r4 = await postMessages({
  model: 'mock-model', max_tokens: 50,
  messages: [
    { role: 'user', content: 'weather in Tokyo?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Tokyo' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '22C sunny' }] },
  ],
})
check('round-trip: 200', r4.status === 200)
const up4 = captured.at(-1).body.messages
check('round-trip: assistant tool_calls translated', up4?.[1]?.role === 'assistant' && up4[1].tool_calls?.[0]?.id === 'call_1' && JSON.parse(up4[1].tool_calls[0].function.arguments).city === 'Tokyo')
check('round-trip: tool_result becomes role:tool', up4?.[2]?.role === 'tool' && up4[2].tool_call_id === 'call_1' && up4[2].content === '22C sunny')

// ─── 5. Reasoning content → thinking blocks ────────────────────────

scenario = 'stream-reasoning'
const r5 = await postStream({ model: 'mock-model', max_tokens: 50, messages: [{ role: 'user', content: 'q' }] })
const thinkStart = r5.frames.find((f) => f.event === 'content_block_start' && f.data.content_block?.type === 'thinking')
const thinkDelta = r5.frames.find((f) => f.event === 'content_block_delta' && f.data.delta?.type === 'thinking_delta')
check('stream reasoning: thinking block opened + delta', Boolean(thinkStart) && thinkDelta?.data.delta?.thinking === 'thinking hard')
const blockStarts = r5.frames.filter((f) => f.event === 'content_block_start')
check('stream reasoning: distinct indices for thinking/text', blockStarts.length === 2 && blockStarts[0].data.index === 0 && blockStarts[1].data.index === 1)

// ─── 6. Error mapping ──────────────────────────────────────────────

scenario = 'error'
const r6 = await postMessages({ model: 'mock-model', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })
check('error: 401 status', r6.status === 401)
check('error: anthropic error envelope', r6.json.type === 'error' && r6.json.error?.type === 'authentication_error' && r6.json.error?.message === 'bad key')

// ─── 7. count_tokens + models proxy ────────────────────────────────

scenario = 'text'
const r7 = await fetch(`${GW}/v1/messages/count_tokens`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hello world '.repeat(10) }] }),
}).then((r) => r.json())
check('count_tokens: positive estimate', typeof r7.input_tokens === 'number' && r7.input_tokens > 10)
const r8 = await fetch(`${GW}/v1/models`).then((r) => r.json())
check('models: upstream passthrough', r8.data?.[0]?.id === 'mock-model')

// ─── 8. tool_choice mapping ────────────────────────────────────────

await postMessages({
  model: 'mock-model', max_tokens: 10,
  messages: [{ role: 'user', content: 'x' }],
  tools: [{ name: 'x', input_schema: {} }],
  tool_choice: { type: 'tool', name: 'x' },
})
check('tool_choice: named tool → function object', captured.at(-1).body.tool_choice?.type === 'function' && captured.at(-1).body.tool_choice.function?.name === 'x')
await postMessages({
  model: 'mock-model', max_tokens: 10,
  messages: [{ role: 'user', content: 'x' }],
  tools: [{ name: 'x', input_schema: {} }],
  tool_choice: { type: 'any' },
})
check('tool_choice: any → required', captured.at(-1).body.tool_choice === 'required')

// ─── 9. Lifecycle ──────────────────────────────────────────────────

await gateway.stop()
let stopped = false
try {
  await fetch(`${GW}/api/hello`)
} catch { stopped = true }
check('lifecycle: gateway closed after stop()', stopped)

upstream.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
