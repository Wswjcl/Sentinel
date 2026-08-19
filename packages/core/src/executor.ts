import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { OpenCodeEventParser } from './opencode-events.js'
import type { TaskConfig, TaskRunRecord } from './types.js'

/**
 * On Windows, opencode installed via npm is a `.cmd` shim, which Node's
 * spawn() refuses to execute without a shell (and a shell would reintroduce
 * command-injection risk). Resolve the real native `.exe` behind the shim:
 * prefer a `.exe` directly on PATH, otherwise parse the `.cmd` for the
 * embedded executable path (`%dp0%` = the shim's directory).
 */
function resolveWindowsBinary(opencodeBin: string): string {
  const probe = spawnSync('where', [opencodeBin], { timeout: 5000, encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return opencodeBin
  const lines = (probe.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'))
  if (exe) return exe
  const cmd = lines.find((l) => l.toLowerCase().endsWith('.cmd'))
  if (cmd) {
    try {
      const m = readFileSync(cmd, 'utf8').match(/"([^"]+\.exe)"/)
      if (m) {
        const resolved = m[1].replace(/%dp0%/i, dirname(cmd))
        if (existsSync(resolved)) return resolved
      }
    } catch {
      // unreadable shim - fall through to the configured name
    }
  }
  return opencodeBin
}

export interface ExecutorOptions {
  taskDir: string
  config: TaskConfig
  opencodeBin?: string
  /** Override the execution prompt (used by Agent Loop for fix iterations).
   *  When provided, this replaces config.execution.prompt in the CLI args. */
  promptOverride?: string
  /** Session continuity: continue or fork an existing OpenCode session
   *  instead of starting a fresh one. */
  continueSession?: { sessionId: string; fork: boolean }
}

export interface ExecutionResult {
  record: TaskRunRecord
  /** Raw stdout (the full JSON event stream, unmodified) */
  stdout: string
  stderr: string
  /** Clean execution digest: assistant text plus a tool-call trace.
   *  Better prompt material than raw stdout for verification / fix loops. */
  summary: string
}

/** Human-readable digest of a run: what the agent said and did. */
function buildSummary(text: string, toolCalls: TaskRunRecord['toolCalls']): string {
  const parts: string[] = []
  if (text) parts.push(text)
  if (toolCalls && toolCalls.length > 0) {
    parts.push('--- tool calls ---')
    for (const call of toolCalls) {
      const label = call.title ? `${call.tool}: ${call.title}` : call.tool
      const state = call.status === 'completed' ? '' : ` [${call.status}]`
      parts.push(`- ${label}${state}`)
    }
  }
  return parts.join('\n')
}

export async function executeTask(
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const { taskDir, config, opencodeBin = 'opencode', promptOverride } = options
  const exec = config.execution
  const recordId = randomUUID()

  // Use promptOverride if provided (Agent Loop fix iterations), otherwise original prompt
  const effectivePrompt = promptOverride ?? exec.prompt

  // Build args array - no shell expansion to prevent command injection.
  // NOTE: no --skill flag - opencode loads skills automatically from the
  // task workspace (.opencode/skills/). exec.skills only drives scaffolding
  // at task-creation time.
  const args: string[] = [
    'run',
    '--dir', taskDir,
    // Auto-approves permissions that are not explicitly denied - the deny
    // rules written into the task's .opencode config are still enforced.
    '--dangerously-skip-permissions',
    '--format', 'json',
  ]

  if (exec.model) args.push('--model', exec.model)
  if (exec.agent) args.push('--agent', exec.agent)
  if (options.continueSession) {
    args.push('--session', options.continueSession.sessionId)
    if (options.continueSession.fork) args.push('--fork')
  }

  args.push(effectivePrompt)

  const record: TaskRunRecord = {
    id: recordId,
    taskName: config.name,
    startedAt: new Date().toISOString(),
    status: 'running',
  }

  // Pre-flight: check if opencode is available.
  // Args-array form only - never interpolate the user-configured binary
  // path into a shell command string (command injection).
  const resolvedBin =
    process.platform === 'win32' ? resolveWindowsBinary(opencodeBin) : opencodeBin
  const probe = spawnSync(resolvedBin, ['--version'], { timeout: 15000 })
  if (probe.error || probe.status !== 0) {
    record.finishedAt = new Date().toISOString()
    record.exitCode = -1
    record.status = 'failed'
    record.error = `OpenCode CLI ("${opencodeBin}") not found. Please install it first: npm i -g opencode`
    return {
      record,
      stdout: '',
      stderr: record.error,
      summary: record.error,
    }
  }

  return new Promise((resolve) => {
    let combinedOutput = ''
    let stderrOutput = ''
    const parser = new OpenCodeEventParser()
    const proc = spawn(resolvedBin, args, {
      cwd: taskDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (exec.timeout ?? 600) * 1000,
      // NOTE: shell: true removed - prevents shell expansion injection
      // in prompt content (e.g. $(...), backticks, semicolons)
    })

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      combinedOutput += chunk
      parser.push(chunk)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString()
    })

    proc.on('close', (code) => {
      const summaryEvents = parser.finalize()

      record.finishedAt = new Date().toISOString()
      record.exitCode = code ?? -1
      record.sessionId = summaryEvents.sessionId
      if (summaryEvents.sawJsonEvents) {
        record.tokens = summaryEvents.tokens
        record.cost = summaryEvents.cost
        record.steps = summaryEvents.steps
        record.toolCalls = summaryEvents.toolCalls
      }

      // Prefer the assistant's actual text; fall back to the tool-call
      // digest (some runs legitimately end right after a tool call with
      // no final text), then to the raw tail when the stream wasn't JSON.
      const summary = buildSummary(
        summaryEvents.text,
        summaryEvents.toolCalls,
      )
      record.output = summaryEvents.sawJsonEvents
        ? (summaryEvents.text || summary || combinedOutput.slice(-5000))
        : combinedOutput.slice(-5000)

      // Fail-closed: an error event means the run failed even if the
      // process somehow exits 0.
      const eventErrors = summaryEvents.errors.join('; ')
      if (eventErrors) {
        record.status = 'failed'
        if (!record.error) record.error = eventErrors
      } else {
        record.status = code === 0 ? 'success' : 'failed'
      }

      if (record.status === 'failed' && !record.error) {
        // Include stderr snippet in the error for easier debugging
        const stderrHint = stderrOutput.slice(-500).trim()
        record.error = stderrHint
          ? `Process exited with code ${code}: ${stderrHint}`
          : `Process exited with code ${code}`
      }

      resolve({
        record,
        stdout: combinedOutput,
        stderr: stderrOutput,
        summary: summary || record.output || '',
      })
    })

    proc.on('error', (err) => {
      record.finishedAt = new Date().toISOString()
      record.exitCode = -1
      record.status = 'failed'
      record.error = err.message

      resolve({
        record,
        stdout: combinedOutput,
        stderr: err.message,
        summary: err.message,
      })
    })
  })
}
