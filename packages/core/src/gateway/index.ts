/**
 * Protocol gateway: exposes Anthropic Messages API on 127.0.0.1 and
 * translates to one OpenAI-compatible upstream. Claude Code points at
 * it; provider keys stay inside Sentinel. The Codex runtime will add a
 * Responses-API frontend over the same translation core later.
 */
export { ProtocolGateway } from './server.js'
export type { GatewayOptions } from './server.js'
export {
  anthropicToOpenAIRequest,
  anthropicMessagesToOpenAI,
  openAIToAnthropicResponse,
  StreamTranslator,
  estimateInputTokens,
  mapFinishReason,
} from './translate.js'
export type { AnthropicSseEvent } from './translate.js'
export type * from './types.js'
