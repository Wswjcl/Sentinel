import type {
  AnthropicContentBlock,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  AnthropicUsage,
  OpenAIChatChunk,
  OpenAIChatMessage,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIContent,
  OpenAIFunctionTool,
  OpenAIUsage,
} from './types.js'

/**
 * Pure translation between the Anthropic Messages API and OpenAI Chat
 * Completions. No I/O lives here - the gateway server feeds these
 * functions, and the smoke suite drives them directly against recorded
 * wire shapes.
 *
 * The tricky parts, called out where they occur: tool_result turns
 * become `role: "tool"` messages that must directly follow the
 * assistant turn carrying the matching tool_calls, and streamed tool
 * calls arrive as argument fragments keyed by index that must be
 * reassembled into Anthropic tool_use blocks with input_json_delta.
 */

// ─── Request: Anthropic → OpenAI ───────────────────────────────────

function textOfContent(content: AnthropicMessagesRequest['messages'][number]['content']): string {
  return typeof content === 'string' ? content : ''
}

/** Convert one Anthropic conversation into OpenAI chat messages. */
export function anthropicMessagesToOpenAI(messages: AnthropicMessagesRequest['messages']): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = []
  for (const msg of messages) {
    const blocks: AnthropicContentBlock[] =
      typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content

    if (msg.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: NonNullable<OpenAIChatMessage['tool_calls']> = []
      for (const b of blocks) {
        if (b.type === 'text') textParts.push(b.text)
        else if (b.type === 'tool_use') {
          toolCalls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          })
        }
        // thinking blocks have no OpenAI chat representation - dropped
      }
      const openai: OpenAIChatMessage = { role: 'assistant', content: textParts.join('') || null }
      if (toolCalls.length > 0) openai.tool_calls = toolCalls
      out.push(openai)
      continue
    }

    // User turns: text/images accumulate into one message; tool_result
    // blocks fan out into role:"tool" messages in order.
    const textParts: string[] = []
    const images: Array<Record<string, unknown>> = []
    for (const b of blocks) {
      if (b.type === 'text') textParts.push(b.text)
      else if (b.type === 'image' && b.source?.type === 'base64') {
        images.push({
          type: 'image_url',
          image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
        })
      } else if (b.type === 'tool_result') {
        flushUserContent(out, textParts, images)
        out.push(toolResultToOpenAI(b))
      }
      // thinking blocks in user turns are not a thing - ignored
    }
    flushUserContent(out, textParts, images)
  }
  return out
}

function flushUserContent(
  out: OpenAIChatMessage[],
  textParts: string[],
  images: Array<Record<string, unknown>>,
): void {
  if (textParts.length === 0 && images.length === 0) return
  const content: OpenAIContent =
    images.length === 0
      ? textParts.join('')
      : [
          ...(textParts.join('') ? [{ type: 'text', text: textParts.join('') }] : []),
          ...images,
        ]
  out.push({ role: 'user', content })
  textParts.length = 0
  images.length = 0
}

function toolResultContentText(b: AnthropicToolResultBlock): string {
  if (typeof b.content === 'string') return b.content
  return b.content
    .map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? '[image]' : ''))
    .join('')
}

function toolResultToOpenAI(b: AnthropicToolResultBlock): OpenAIChatMessage {
  const text = toolResultContentText(b)
  return {
    role: 'tool',
    tool_call_id: b.tool_use_id,
    // Some strict OpenAI-compatible endpoints reject empty tool content.
    content: text.length > 0 ? text : (b.is_error ? 'error: (empty result)' : '(empty result)'),
  }
}

export function anthropicToOpenAIRequest(req: AnthropicMessagesRequest): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = []

  const system =
    typeof req.system === 'string'
      ? req.system
      : (req.system ?? []).map((b) => b.text).join('')
  if (system) messages.push({ role: 'system', content: system })

  messages.push(...anthropicMessagesToOpenAI(req.messages))

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
  }
  if (req.temperature !== undefined) out.temperature = req.temperature
  if (req.top_p !== undefined) out.top_p = req.top_p
  if (req.stop_sequences?.length) out.stop = req.stop_sequences
  if (req.stream) {
    out.stream = true
    // Ask for a trailing usage chunk; providers that ignore it simply
    // leave usage zeroed and the gateway keeps its running estimate.
    out.stream_options = { include_usage: true }
  }
  if (req.tools?.length) {
    const tools: OpenAIFunctionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))
    out.tools = tools
    const tc = req.tool_choice
    out.tool_choice =
      tc?.type === 'tool' && tc.name
        ? { type: 'function', function: { name: tc.name } }
        : tc?.type === 'any'
          ? 'required'
          : tc?.type === 'none'
            ? 'none'
            : 'auto'
  }
  return out
}

// ─── Non-streaming response: OpenAI → Anthropic ────────────────────

export function mapFinishReason(finish: string | null | undefined): AnthropicStopReason {
  switch (finish) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

function mapUsage(u: OpenAIUsage | undefined): AnthropicUsage {
  const usage: AnthropicUsage = {
    input_tokens: u?.prompt_tokens ?? 0,
    output_tokens: u?.completion_tokens ?? 0,
  }
  const cached = u?.prompt_tokens_details?.cached_tokens
  if (cached) usage.cache_read_input_tokens = cached
  return usage
}

export function openAIToAnthropicResponse(resp: OpenAIChatResponse, fallbackModel: string): AnthropicMessagesResponse {
  const choice = resp.choices?.[0]
  const msg = choice?.message
  const content: AnthropicMessagesResponse['content'] = []
  if (msg?.content) content.push({ type: 'text', text: msg.content })
  for (const call of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {}
    try {
      input = call.function?.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {}
    } catch {
      input = { _raw: call.function?.arguments ?? '' }
    }
    content.push({
      type: 'tool_use',
      id: call.id || `call_${Math.random().toString(36).slice(2)}`,
      name: call.function?.name ?? 'unknown',
      input,
    })
  }
  if (content.length === 0) content.push({ type: 'text', text: '' })
  return {
    id: resp.id ?? 'msg_gateway',
    type: 'message',
    role: 'assistant',
    model: resp.model ?? fallbackModel,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: mapUsage(resp.usage),
  }
}

// ─── Streaming: OpenAI chunks → Anthropic SSE events ───────────────

export interface AnthropicSseEvent {
  event: string
  data: Record<string, unknown>
}

function sse(event: AnthropicSseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}

/**
 * Stateful translator for one streamed response. Feed it OpenAI chunks
 * (in order); it yields Anthropic SSE frames. Call finish() after the
 * upstream stream ends (or on [DONE]) to close any open block and emit
 * message_delta + message_stop. Block indices follow Anthropic rules:
 * one index per content block, deltas reference the open index.
 */
export class StreamTranslator {
  private nextIndex = 0
  private openTextIndex: number | null = null
  private openThinkingIndex: number | null = null
  // OpenAI keys streaming tool calls by fragment index; Anthropic wants
  // one content block per call, opened on first sight of that index.
  private toolBlocks = new Map<number, { index: number; id: string; name: string; args: string; opened: boolean }>()
  private readonly model: string
  private readonly startedAt = Date.now()
  private lastUsage: OpenAIUsage | undefined

  constructor(model: string) {
    this.model = model
  }

  /** message_start frame - call once before the first chunk. */
  start(): string {
    return sse({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: `msg_gateway_${this.startedAt}`,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    })
  }

  /** Translate one upstream chunk into zero or more SSE frames. */
  push(chunk: OpenAIChatChunk): string {
    if (chunk.usage) this.lastUsage = chunk.usage
    const frames: string[] = []
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}

      // Reasoning content (deepseek-r1 style) maps to a thinking block.
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        if (this.openThinkingIndex === null) {
          if (this.openTextIndex !== null) {
            frames.push(this.closeBlock(this.openTextIndex))
            this.openTextIndex = null
          }
          this.openThinkingIndex = this.nextIndex++
          frames.push(
            sse({
              event: 'content_block_start',
              data: { type: 'content_block_start', index: this.openThinkingIndex, content_block: { type: 'thinking', thinking: '' } },
            }),
          )
        }
        frames.push(
          sse({
            event: 'content_block_delta',
            data: {
              type: 'content_block_delta',
              index: this.openThinkingIndex,
              delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
            },
          }),
        )
      }

      if (typeof delta.content === 'string' && delta.content) {
        if (this.openThinkingIndex !== null) {
          frames.push(this.closeBlock(this.openThinkingIndex))
          this.openThinkingIndex = null
        }
        if (this.openTextIndex === null) {
          this.openTextIndex = this.nextIndex++
          frames.push(
            sse({
              event: 'content_block_start',
              data: { type: 'content_block_start', index: this.openTextIndex, content_block: { type: 'text', text: '' } },
            }),
          )
        }
        frames.push(
          sse({
            event: 'content_block_delta',
            data: { type: 'content_block_delta', index: this.openTextIndex, delta: { type: 'text_delta', text: delta.content } },
          }),
        )
      }

      for (const frag of delta.tool_calls ?? []) {
        if (this.openThinkingIndex !== null) {
          frames.push(this.closeBlock(this.openThinkingIndex))
          this.openThinkingIndex = null
        }
        if (this.openTextIndex !== null) {
          frames.push(this.closeBlock(this.openTextIndex))
          this.openTextIndex = null
        }
        let block = this.toolBlocks.get(frag.index)
        if (!block) {
          block = {
            index: this.nextIndex++,
            id: frag.id ?? `call_${frag.index}_${Math.random().toString(36).slice(2)}`,
            name: frag.function?.name ?? '',
            args: '',
            opened: false,
          }
          this.toolBlocks.set(frag.index, block)
        }
        if (frag.id) block.id = frag.id
        if (frag.function?.name) block.name = frag.function.name
        if (!block.opened && block.name) {
          block.opened = true
          frames.push(
            sse({
              event: 'content_block_start',
              data: {
                type: 'content_block_start',
                index: block.index,
                content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
              },
            }),
          )
        }
        if (frag.function?.arguments) {
          block.args += frag.function.arguments
          frames.push(
            sse({
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: block.index,
                delta: { type: 'input_json_delta', partial_json: frag.function.arguments },
              },
            }),
          )
        }
      }
    }
    return frames.join('')
  }

  private closeBlock(index: number): string {
    return sse({ event: 'content_block_stop', data: { type: 'content_block_stop', index } })
  }

  /** Close open blocks and emit message_delta + message_stop. */
  finish(finishReason: string | null): string {
    const frames: string[] = []
    if (this.openTextIndex !== null) frames.push(this.closeBlock(this.openTextIndex))
    if (this.openThinkingIndex !== null) frames.push(this.closeBlock(this.openThinkingIndex))
    for (const block of [...this.toolBlocks.values()].sort((a, b) => a.index - b.index)) {
      if (block.opened) frames.push(this.closeBlock(block.index))
      // A tool call with a name but no opened block (no arguments seen)
      // still needs its start frame before the stop frame.
      if (!block.opened && block.name) {
        frames.push(
          sse({
            event: 'content_block_start',
            data: {
              type: 'content_block_start',
              index: block.index,
              content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
            },
          }),
        )
        frames.push(this.closeBlock(block.index))
        block.opened = true
      }
    }
    const usage = mapUsage(this.lastUsage)
    frames.push(
      sse({
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: mapFinishReason(finishReason), stop_sequence: null },
          usage,
        },
      }),
    )
    frames.push(sse({ event: 'message_stop', data: { type: 'message_stop' } }))
    return frames.join('')
  }
}

// ─── Shared helpers ────────────────────────────────────────────────

/** Rough token estimate for /v1/messages/count_tokens (the Anthropic
 *  SDK only needs a plausible number for context-window management). */
export function estimateInputTokens(req: AnthropicMessagesRequest): number {
  let chars = ''
  for (const m of req.messages) chars += textOfContent(m.content)
  if (typeof req.system === 'string') chars += req.system
  else chars += (req.system ?? []).map((b) => b.text).join('')
  chars += JSON.stringify(req.tools ?? '')
  return Math.max(1, Math.ceil(chars.length / 4))
}

/** Extract the assistant text of a completed translation (used by the
 *  server to log short digests; also handy in tests). */
export function firstToolUseId(blocks: AnthropicContentBlock[]): string | undefined {
  return blocks.find((b): b is AnthropicToolUseBlock => b.type === 'tool_use')?.id
}
