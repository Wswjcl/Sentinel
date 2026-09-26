import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ProtocolGateway } from '@sentinel/core'
import type {
  ExecutorOptions,
  ExecutionResult,
  TaskRunRecord,
  TokenUsage,
  PermissionResponse,
  PermissionAskRecord,
  ToolCallRecord,
} from '@sentinel/core'
import type { ProviderProfile, LiveEventData, PermissionAskData } from '../shared/ipc-types'
import type {
  CanUseTool,
  ModelUsage,
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude Code runtime: executes tasks through the official Agent SDK
 * (@anthropic-ai/claude-agent-sdk) pointed at the local protocol
 * gateway, so any OpenAI-compatible provider can serve a Claude Code
 * session while its API key never leaves the Sentinel process.
 *
 * Per run: resolve the bound provider profile, spin up a ProtocolGateway
 * (Anthropic Messages in → OpenAI Chat Completions out), start an SDK
 * query with ANTHROPIC_BASE_URL at the gateway, and map the SDK message
 * stream onto the same Live events / permission dialogs / run records
 * the serve runtime produces.
 */

/** How long a permission dialog stays open before auto-deny (same
 *  discipline as the opencode permission bridge in core). */
const PERMISSION_TIMEOUT_MS = 120_000

type ClaudeSdk = typeof import('@anthropic-ai/claude-agent-sdk')

/**
 * The SDK is ESM-only ("main": "sdk.mjs") while electron-vite builds the
 * main process as CJS: Electron 34's Node (20.18) cannot require() ESM,
 * and an analyzable dynamic import of an externalized dependency gets
 * compiled down to require(). An indirect import() defeats static
 * analysis so a real dynamic import survives in the bundle.
 */
function loadSdk(): Promise<ClaudeSdk> {
  const indirectImport = new Function('s', 'return import(s)') as (s: string) => Promise<ClaudeSdk>
  return indirectImport('@anthropic-ai/claude-agent-sdk')
}

/**
 * Real path of the bundled Claude CLI binary for this platform. Packaged
 * builds extract the platform package next to the asar via
 * asarUnpack (electron-builder.yml) - native executables cannot be
 * spawned from inside app.asar - so the path is rewritten accordingly.
 * Undefined in dev/unexpected layouts lets the SDK use its own default.
 */
function bundledClaudeBinary(): string | undefined {
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
    const bin = join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude')
    if (!existsSync(bin)) return undefined
    return bin.replace('app.asar', 'app.asar.unpacked')
  } catch {
    return undefined
  }
}

export interface ClaudeExecutorDeps {
  /** Provider profile registry (main process - holds the API keys). */
  profiles: () => ProviderProfile[]
  /** Sentinel-managed CLAUDE_CONFIG_DIR: keeps session state and
   *  onboarding flags out of the user's real ~/.claude and gives
   *  session continuity (resume/fork) a stable home. */
  claudeConfigDir: string
  /** Shared in-flight abort registry keyed by task name (TASK_ABORT). */
  abortControllers: Map<string, Set<AbortController>>
  /** Live event sink, routed to the renderer by task name. */
  onEvent: (name: string, event: LiveEventData) => void
  /** Surface a permission ask; resolves with the user's answer. */
  askPermission: (name: string, ask: PermissionAskData) => Promise<PermissionResponse>
  /** Drop a pending ask (after timeout) so late answers are ignored. */
  dropPermission: (askId: string) => void
  /** Renderer + log side effects once an ask settles. */
  onPermissionResult: (
    name: string,
    ask: { id: string; permission: string; patterns: string[] },
    response: PermissionResponse | 'timeout',
  ) => void
  /** Scheduler log sink. */
  onLog: (level: 'info' | 'warn' | 'error', msg: string) => void
}

/** Best-effort human-readable object of a tool call for titles/patterns. */
function describeInput(input: Record<string, unknown>): string | undefined {
  for (const key of ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'description']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      const text = value.trim()
      return text.length > 200 ? `${text.slice(0, 200)}…` : text
    }
  }
  return undefined
}

/** tool_result content comes as a string or a block array - flatten to
 *  bounded text for the run-record audit. */
function flattenToolResult(content: unknown): string {
  const bound = (s: string): string => (s.length > 2000 ? `${s.slice(0, 2000)}…` : s)
  if (typeof content === 'string') return bound(content)
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        texts.push((block as { text: string }).text)
      }
    }
    return bound(texts.join('\n'))
  }
  return ''
}

/** Token totals across every model call (main loop + subagents); falls
 *  back to the main-loop usage when modelUsage is empty. */
function sumModelUsage(modelUsage: Record<string, ModelUsage>): TokenUsage | null {
  let input = 0
  let output = 0
  for (const m of Object.values(modelUsage)) {
    input += m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens
    output += m.outputTokens
  }
  if (input === 0 && output === 0) return null
  return { input, output, total: input + output }
}

export function makeClaudeExecutor(
  deps: ClaudeExecutorDeps,
): (options: ExecutorOptions) => Promise<ExecutionResult> {
  return async (options) => {
    const { taskDir, config } = options
    const name = config.name
    const effectivePrompt = options.promptOverride ?? config.execution.prompt

    const record: TaskRunRecord = {
      id: randomUUID(),
      taskName: name,
      startedAt: new Date().toISOString(),
      status: 'running',
    }

    const abortController = new AbortController()
    let controllers = deps.abortControllers.get(name)
    if (!controllers) {
      controllers = new Set()
      deps.abortControllers.set(name, controllers)
    }
    controllers.add(abortController)

    let gateway: ProtocolGateway | null = null
    let stderrOutput = ''
    const asks: PermissionAskRecord[] = []
    const toolCalls: ToolCallRecord[] = []
    const textParts: string[] = []
    let sessionId = ''

    // canUseTool closure: every non-trusted tool call becomes a dialog.
    // 'always' applies the SDK's own session-scoped suggestions so the
    // user isn't re-asked for the same tool during the session.
    const canUseTool: CanUseTool = async (toolName, input, toolOptions) => {
      if (toolOptions.signal.aborted) {
        return { behavior: 'deny', message: 'run aborted' }
      }
      const askId = randomUUID()
      const describe = describeInput(input)
      const patterns = describe ? [describe] : []
      const ask: PermissionAskData = {
        id: askId,
        sessionId,
        permission: toolName,
        patterns,
        metadata: { input },
        always: (toolOptions.suggestions?.length ?? 0) > 0 ? ['always'] : [],
      }
      const audit: PermissionAskRecord = {
        permission: toolName,
        patterns,
        response: 'timeout',
        at: new Date().toISOString(),
      }
      asks.push(audit)
      deps.onEvent(name, { kind: 'status', status: 'permission-asked' })

      const answer = await Promise.race([
        deps.askPermission(name, ask),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), PERMISSION_TIMEOUT_MS),
        ),
      ])
      deps.dropPermission(askId)
      audit.response = answer
      audit.at = new Date().toISOString()
      deps.onPermissionResult(name, { id: askId, permission: toolName, patterns }, answer)

      if (answer === 'reject') {
        return { behavior: 'deny', message: '用户拒绝了该权限请求' }
      }
      if (answer === 'timeout') {
        return { behavior: 'deny', message: `权限请求超时（${PERMISSION_TIMEOUT_MS / 1000} 秒无响应），已自动拒绝` }
      }
      if (answer === 'always' && toolOptions.suggestions && toolOptions.suggestions.length > 0) {
        return { behavior: 'allow', updatedPermissions: toolOptions.suggestions }
      }
      return { behavior: 'allow' }
    }

    try {
      // Provider binding: the claude runtime has no global fallback
      // config - it serves runs through a profile bound to the task.
      const profileId = config.execution.providerProfile
      const profile = profileId
        ? deps.profiles().find((p) => p.id === profileId)
        : undefined
      if (!profile || !profile.baseUrl || !profile.apiKey) {
        throw new Error(
          `Claude runtime requires a provider profile with baseUrl and apiKey bound to the task (current binding: ${profileId ?? 'none'})`,
        )
      }
      const model = config.execution.model?.trim() || profile.model
      record.provider = profile.provider
      record.modelUsed = model
      record.endpoint = profile.baseUrl
      record.providerSource = 'workspace'

      gateway = new ProtocolGateway({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        onLog: (level, msg) => deps.onLog(level, msg),
      })
      const port = await gateway.start()

      // Isolate the subprocess from the user's real ~/.claude, strip any
      // ambient ANTHROPIC_API_KEY, and route traffic at the gateway
      // (whose Authorization header carries the real upstream key).
      const inherited = { ...process.env }
      delete inherited.ANTHROPIC_API_KEY
      const env: Record<string, string | undefined> = {
        ...inherited,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_AUTH_TOKEN: 'sentinel-gateway',
        CLAUDE_CONFIG_DIR: deps.claudeConfigDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'Sentinel',
      }

      // 'trusted' permission card = bypass all prompts (canUseTool is
      // never called in bypass mode); every other card routes asks
      // through the dialog above.
      const trusted = config.permissions?.preset === 'trusted'

      const sdk = await loadSdk()
      const bundledBinary = bundledClaudeBinary()
      const query = sdk.query({
        prompt: effectivePrompt,
        options: {
          cwd: taskDir,
          model,
          ...(bundledBinary ? { pathToClaudeCodeExecutable: bundledBinary } : {}),
          permissionMode: trusted ? 'bypassPermissions' : 'default',
          allowDangerouslySkipPermissions: trusted,
          ...(trusted ? {} : { canUseTool }),
          settingSources: ['project'],
          abortController,
          env,
          stderr: (data: string) => {
            stderrOutput += data
          },
          ...(options.continueSession
            ? {
                resume: options.continueSession.sessionId,
                forkSession: options.continueSession.fork,
              }
            : {}),
        },
      })

      const timeoutMs = (config.execution.timeout ?? 600) * 1000
      const timeout = setTimeout(() => abortController.abort(), timeoutMs)

      try {
        const pendingTools = new Map<string, { tool: string; title?: string; input: Record<string, unknown> }>()
        let sawResult = false

        for await (const message of query) {
          if (message.session_id) sessionId = message.session_id

          if (message.type === 'system' && message.subtype === 'init') {
            deps.onEvent(name, { kind: 'status', status: 'running' })
            continue
          }

          // Subagent frames are skipped: forwardSubagentText is off, so
          // the Live stream stays on the main loop.
          if (message.type === 'assistant' && message.parent_tool_use_id === null) {
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text) {
                textParts.push(block.text)
                deps.onEvent(name, { kind: 'text', text: block.text })
              } else if (block.type === 'thinking' && block.thinking) {
                deps.onEvent(name, { kind: 'reasoning', text: block.thinking })
              } else if (block.type === 'tool_use') {
                const toolInput = (block.input ?? {}) as Record<string, unknown>
                const title = describeInput(toolInput)
                pendingTools.set(block.id, { tool: block.name, title, input: toolInput })
                deps.onEvent(name, { kind: 'tool-start', tool: block.name, title })
              }
            }
            continue
          }

          if (message.type === 'user' && message.parent_tool_use_id === null) {
            const content = message.message.content
            const blocks = typeof content === 'string' ? [] : content
            for (const block of blocks) {
              if (block.type !== 'tool_result') continue
              const started = pendingTools.get(block.tool_use_id)
              if (!started) continue
              pendingTools.delete(block.tool_use_id)
              const status = block.is_error ? 'error' : 'completed'
              toolCalls.push({
                tool: started.tool,
                title: started.title,
                status,
                input: started.input,
                output: flattenToolResult(block.content),
              })
              deps.onEvent(name, { kind: 'tool-finish', tool: started.tool, title: started.title, status })
            }
            continue
          }

          if (message.type === 'result') {
            sawResult = true
            record.sessionId = message.session_id
            record.finishedAt = new Date().toISOString()
            record.cost = message.total_cost_usd
            record.steps = message.num_turns
            record.tokens =
              sumModelUsage(message.modelUsage) ??
              (() => {
                const input =
                  message.usage.input_tokens +
                  message.usage.cache_read_input_tokens +
                  message.usage.cache_creation_input_tokens
                return { input, output: message.usage.output_tokens, total: input + message.usage.output_tokens }
              })()
            if (message.subtype === 'success') {
              record.output = message.result || textParts.join('\n\n') || undefined
              if (message.is_error) {
                record.status = 'failed'
                record.error = message.result || 'run ended with an API error'
              } else {
                record.status = 'success'
              }
            } else {
              record.status = 'failed'
              record.error =
                message.errors.join('; ') || `run stopped early: ${message.subtype}`
            }
          }
        }

        if (!sawResult && record.status === 'running') {
          record.status = 'failed'
          record.error = 'SDK stream ended without a result message'
        }
        if (abortController.signal.aborted && record.status === 'running') {
          record.status = 'failed'
          record.error = 'run aborted (timeout or user stop)'
        }
      } finally {
        clearTimeout(timeout)
      }
    } catch (err) {
      record.status = 'failed'
      record.finishedAt = new Date().toISOString()
      record.error =
        record.error ??
        (abortController.signal.aborted
          ? 'run aborted (timeout or user stop)'
          : err instanceof Error
            ? err.message
            : String(err))
    } finally {
      if (gateway) await gateway.stop().catch(() => {})
      controllers.delete(abortController)
      if (controllers.size === 0) deps.abortControllers.delete(name)
    }

    if (record.status === 'running') {
      // Defensive: every path above settles the status.
      record.status = 'failed'
      record.finishedAt = record.finishedAt ?? new Date().toISOString()
      record.error = record.error ?? 'run did not settle'
    }
    record.finishedAt = record.finishedAt ?? new Date().toISOString()
    record.exitCode = record.status === 'success' ? 0 : -1
    if (asks.length > 0) record.permissionAsks = asks
    if (toolCalls.length > 0) record.toolCalls = toolCalls
    if (!record.output && textParts.length > 0) record.output = textParts.join('\n\n')

    const summaryParts: string[] = []
    if (record.output) summaryParts.push(record.output)
    if (toolCalls.length > 0) {
      summaryParts.push('--- tool calls ---')
      for (const call of toolCalls) {
        const label = call.title ? `${call.tool}: ${call.title}` : call.tool
        const state = call.status === 'completed' ? '' : ` [${call.status}]`
        summaryParts.push(`- ${label}${state}`)
      }
    }

    return {
      record,
      stdout: textParts.join('\n\n') || record.output || '',
      stderr: stderrOutput || (record.status === 'failed' ? record.error ?? '' : ''),
      summary: summaryParts.join('\n'),
    }
  }
}
