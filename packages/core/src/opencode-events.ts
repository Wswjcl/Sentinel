// ─── OpenCode JSON Event Stream Parser ──────────────────────
//
// `opencode run --format json` emits one JSON object per line on
// stdout. Observed event shapes (opencode 1.17.x):
//
//   {"type":"step_start","sessionID":"ses_...","part":{"type":"step-start"}}
//   {"type":"text","part":{"type":"text","text":"..."}}
//   {"type":"tool_use","part":{"type":"tool","tool":"write",
//     "callID":"...","state":{"status":"completed","input":{...},
//     "output":"...","title":"..."}}}
//   {"type":"step_finish","part":{"type":"step-finish","reason":"stop",
//     "tokens":{"total":1,"input":1,"output":1,...},"cost":0}}
//   {"type":"error","error":{"name":"...","data":{"message":"..."}}}
//
// Unknown event types are ignored so newer opencode versions don't
// break the parser.

export interface ToolCallRecord {
  tool: string
  title?: string
  status: string
  input?: unknown
  output?: string
}

export interface RunEventSummary {
  /** OpenCode session id (from the first event that carries one) */
  sessionId?: string
  /** Assistant text parts concatenated in order */
  text: string
  /** Token usage summed across all step_finish events */
  tokens: { input: number; output: number; total: number }
  /** Cost in USD summed across all step_finish events */
  cost: number
  /** Number of step_finish events (LLM round-trips) */
  steps: number
  /** Tool calls in execution order (bounded to the last MAX_TOOL_CALLS) */
  toolCalls: ToolCallRecord[]
  /** Structured error messages from error events */
  errors: string[]
  /** True if at least one line parsed as JSON - i.e. the stream really
   *  was an event stream rather than plain text. */
  sawJsonEvents: boolean
}

const MAX_TOOL_CALLS = 50
const MAX_TOOL_OUTPUT_CHARS = 2000

interface ParsedEvent {
  type?: string
  sessionID?: string
  part?: Record<string, unknown>
  error?: { name?: string; data?: { message?: string } | Record<string, unknown> }
}

export class OpenCodeEventParser {
  private buffer = ''
  private sessionId?: string
  private textParts: string[] = []
  private tokens = { input: 0, output: 0, total: 0 }
  private cost = 0
  private steps = 0
  private toolCalls: ToolCallRecord[] = []
  private errors: string[] = []
  private jsonLines = 0

  /** Feed a raw stdout chunk. Lines may split across chunks. */
  push(chunk: string): void {
    this.buffer += chunk
    let newlineIdx: number
    while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (line) this.parseLine(line)
    }
  }

  private parseLine(line: string): void {
    // --print-logs style diagnostics and other non-JSON noise are skipped
    if (!line.startsWith('{')) return
    let ev: ParsedEvent
    try {
      ev = JSON.parse(line) as ParsedEvent
    } catch {
      return
    }
    this.jsonLines++
    if (!this.sessionId && typeof ev.sessionID === 'string') {
      this.sessionId = ev.sessionID
    }

    switch (ev.type) {
      case 'text': {
        const text = ev.part?.text
        if (typeof text === 'string' && text.trim()) this.textParts.push(text)
        break
      }
      case 'tool_use': {
        const part = ev.part ?? {}
        const state = (part.state ?? {}) as Record<string, unknown>
        const call: ToolCallRecord = {
          tool: typeof part.tool === 'string' ? part.tool : 'unknown',
          status: typeof state.status === 'string' ? state.status : 'unknown',
        }
        if (typeof state.title === 'string') call.title = state.title
        if (state.input !== undefined) call.input = state.input
        if (typeof state.output === 'string') {
          call.output = state.output.slice(0, MAX_TOOL_OUTPUT_CHARS)
        }
        this.toolCalls.push(call)
        if (this.toolCalls.length > MAX_TOOL_CALLS) this.toolCalls.shift()
        break
      }
      case 'step_finish': {
        this.steps++
        const tokens = ev.part?.tokens as Record<string, unknown> | undefined
        if (tokens) {
          if (typeof tokens.input === 'number') this.tokens.input += tokens.input
          if (typeof tokens.output === 'number') this.tokens.output += tokens.output
          if (typeof tokens.total === 'number') this.tokens.total += tokens.total
        }
        const cost = ev.part?.cost
        if (typeof cost === 'number') this.cost += cost
        break
      }
      case 'error': {
        const data = ev.error?.data as Record<string, unknown> | undefined
        const rawMsg = data?.message ?? ev.error?.name ?? 'unknown opencode error'
        this.errors.push(typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg))
        break
      }
      default:
        break
    }
  }

  /** Build the structured summary. Call after the process exits. */
  finalize(): RunEventSummary {
    return {
      sessionId: this.sessionId,
      text: this.textParts.join('\n').trim(),
      tokens: { ...this.tokens },
      cost: this.cost,
      steps: this.steps,
      toolCalls: [...this.toolCalls],
      errors: [...this.errors],
      sawJsonEvents: this.jsonLines > 0,
    }
  }
}
