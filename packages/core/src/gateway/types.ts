/**
 * Wire types for the protocol gateway. Two dialects meet here:
 *
 * - Anthropic Messages API (what Claude Code speaks): system as a
 *   top-level field, content as typed blocks (text / tool_use /
 *   tool_result), SSE events with explicit block lifecycle.
 * - OpenAI Chat Completions (what every third-party provider Sentinel
 *   manages speaks): system as a message role, tool calls as
 *   function-call objects, `data:` SSE chunks.
 *
 * Only the fields the gateway actually reads or emits are typed; unknown
 * fields are passed through structurally where safe.
 */

// ─── Anthropic Messages API ────────────────────────────────────────

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>
  is_error?: boolean
}

export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface AnthropicMessagesRequest {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string | Array<AnthropicTextBlock>
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: { type: 'auto' | 'any' | 'none' | 'tool'; name?: string }
}

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal'

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
}

export interface AnthropicMessagesResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: AnthropicStopReason | null
  stop_sequence: string | null
  usage: AnthropicUsage
}

export interface AnthropicErrorBody {
  type: 'error'
  error: { type: string; message: string }
}

// ─── OpenAI Chat Completions ───────────────────────────────────────

export interface OpenAIFunctionTool {
  type: 'function'
  function: { name: string; description?: string; parameters?: Record<string, unknown> }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Content is a string for plain text turns, an array when images ride along. */
export type OpenAIContent = string | Array<Record<string, unknown>>

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: OpenAIContent | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  tools?: OpenAIFunctionTool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
}

export interface OpenAIUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export interface OpenAIChatResponse {
  id?: string
  model?: string
  choices: Array<{
    message?: { role?: string; content?: string | null; tool_calls?: OpenAIToolCall[] }
    finish_reason?: string | null
  }>
  usage?: OpenAIUsage
}

/** A streamed chat-completions chunk (delta may carry role, text,
 *  reasoning content, or tool-call fragments keyed by index). */
export interface OpenAIChatChunk {
  id?: string
  model?: string
  choices: Array<{
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{ index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>
    }
    finish_reason?: string | null
  }>
  usage?: OpenAIUsage
}
