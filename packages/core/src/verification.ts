import { spawn, spawnSync } from 'node:child_process'
import { executeTask } from './executor.js'
import type { LoopVerification } from './types.js'

// ─── Verification Result ────────────────────────────────────

export interface VerificationResult {
  passed: boolean
  message: string
}

// ─── Verification Options ───────────────────────────────────

export interface VerificationOptions {
  type: 'command' | 'llm'
  /** Shell command for 'command' mode */
  command?: string
  /** Criteria text for 'llm' mode */
  criteria?: string
  /** Skill name for 'llm' mode (optional) */
  skill?: string
  /** Task directory — command runs here */
  taskDir: string
  /** The stdout output from the last execution (for LLM verification) */
  output: string
  /** OpenCode binary path */
  opencodeBin?: string
  /** Model override for LLM verification */
  model?: string
}

// ─── Command Verification ───────────────────────────────────

let resolvedShell: { shell: string; flag: string } | null = null

/** Resolve the shell used for command execution. Prefers POSIX sh
 *  (cross-platform command syntax - Git provides sh.exe on Windows);
 *  falls back to cmd on Windows when no sh is on PATH. */
export function resolveShell(): { shell: string; flag: string } {
  if (resolvedShell) return resolvedShell
  if (process.platform === 'win32') {
    const probe = spawnSync('where', ['sh'], { timeout: 5000 })
    resolvedShell = !probe.error && probe.status === 0
      ? { shell: 'sh', flag: '-c' }
      : { shell: 'cmd', flag: '/c' }
  } else {
    resolvedShell = { shell: 'sh', flag: '-c' }
  }
  return resolvedShell
}

function runCommandVerification(
  command: string,
  taskDir: string,
): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const { shell, flag } = resolveShell()

    const proc = spawn(shell, [flag, command], {
      cwd: taskDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000, // 30s timeout for verification commands
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          passed: true,
          message: stdout.trim() || 'Verification passed (exit code 0)',
        })
      } else {
        const hint = stderr.trim() || stdout.trim() || `Exit code ${code}`
        resolve({
          passed: false,
          message: `Verification failed: ${hint}`,
        })
      }
    })

    proc.on('error', (err) => {
      resolve({
        passed: false,
        message: `Verification command error: ${err.message}`,
      })
    })
  })
}

// ─── LLM Verification ──────────────────────────────────────

async function runLLMVerification(
  criteria: string,
  output: string,
  taskDir: string,
  opencodeBin: string,
  skill?: string,
  model?: string,
): Promise<VerificationResult> {
  // Build verification prompt
  const verificationPrompt = skill
    ? `Use the "${skill}" skill to verify the following output against these criteria:\n\n## Criteria\n${criteria}\n\n## Output to Verify\n${output.slice(-4000)}\n\nRespond with JSON: {"passed": true/false, "issues": ["issue1"], "suggestion": "fix suggestion"}`
    : `Verify the following output against these criteria:\n\n## Criteria\n${criteria}\n\n## Output to Verify\n${output.slice(-4000)}\n\nRespond with JSON: {"passed": true/false, "issues": ["issue1"], "suggestion": "fix suggestion"}`

  // Create a minimal TaskConfig for the verification execution
  const verificationConfig = {
    name: '__verification__',
    description: 'Agent Loop verification',
    version: 1,
    schedule: { type: 'once' as const, expr: 'now' },
    execution: {
      prompt: verificationPrompt,
      model: model || '',
      agent: 'default',
      timeout: 120,
      skills: skill ? [skill] : [],
    },
  }

  try {
    const result = await executeTask({
      taskDir,
      config: verificationConfig,
      opencodeBin,
    })

    if (result.record.status !== 'success') {
      return {
        passed: false,
        message: `LLM verification execution failed: ${result.record.error || 'unknown error'}`,
      }
    }

    // Parse the LLM response for pass/fail.
    // Use the clean assistant text - raw stdout is the JSON event stream,
    // whose metadata (e.g. tool error statuses) would false-match the
    // pass/fail regexes below.
    const responseText = (result.record.output ?? '').trim()

    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*?"passed"[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (typeof parsed.passed === 'boolean') {
          return {
            passed: parsed.passed,
            message: parsed.passed
              ? 'LLM verification passed'
              : `LLM verification failed: ${parsed.issues?.join('; ') || 'unspecified issues'}. Suggestion: ${parsed.suggestion || 'none'}`,
          }
        }
      } catch {
        // JSON parse failed, fall through to heuristic
      }
    }

    // Fail-closed heuristic fallback: negative markers are checked FIRST,
    // so "未通过"/"不通过" can never fall into the positive "通过" branch,
    // and an ambiguous response without an explicit positive marker is
    // treated as a failure rather than a guess.
    const negative = /"passed"\s*:\s*false|未\s*通过|不\s*通过|没\s*有\s*通过|\bfailed?\b|✗|❌|失败/i
    if (negative.test(responseText)) {
      return {
        passed: false,
        message: `LLM verification failed: ${responseText.slice(0, 500)}`,
      }
    }
    const positive = /"passed"\s*:\s*true|\bPASS\b|通过|✓|✔|成功/i
    const passedHeuristic = positive.test(responseText)
    return {
      passed: passedHeuristic,
      message: passedHeuristic
        ? 'LLM verification passed (heuristic)'
        : `LLM verification result (no explicit verdict, treated as failed): ${responseText.slice(0, 500)}`,
    }
  } catch (err) {
    return {
      passed: false,
      message: `LLM verification error: ${String(err)}`,
    }
  }
}

// ─── Main Entry ─────────────────────────────────────────────

export async function runVerification(
  options: VerificationOptions,
): Promise<VerificationResult> {
  if (options.type === 'command') {
    if (!options.command) {
      return { passed: false, message: 'Command verification: no command specified' }
    }
    return runCommandVerification(options.command, options.taskDir)
  } else {
    if (!options.criteria) {
      return { passed: false, message: 'LLM verification: no criteria specified' }
    }
    return runLLMVerification(
      options.criteria,
      options.output,
      options.taskDir,
      options.opencodeBin ?? 'opencode',
      options.skill,
      options.model,
    )
  }
}
