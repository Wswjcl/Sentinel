import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { TaskConfig, TaskRunRecord } from './types.js'

export interface ExecutorOptions {
  taskDir: string
  config: TaskConfig
  opencodeBin?: string
}

export interface ExecutionResult {
  record: TaskRunRecord
  stdout: string
  stderr: string
}

export async function executeTask(
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const { taskDir, config, opencodeBin = 'opencode' } = options
  const exec = config.execution
  const recordId = randomUUID()

  const args: string[] = [
    'run',
    '--dir', taskDir,
    '--dangerously-skip-permissions',
    '--format', 'json',
  ]

  if (exec.model) args.push('--model', exec.model)
  if (exec.agent) args.push('--agent', exec.agent)

  args.push(exec.prompt)

  const record: TaskRunRecord = {
    id: recordId,
    taskName: config.name,
    startedAt: new Date().toISOString(),
    status: 'running',
  }

  return new Promise((resolve) => {
    let combinedOutput = ''
    const proc = spawn(opencodeBin, args, {
      cwd: taskDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (exec.timeout ?? 600) * 1000,
      shell: true,
    })

    proc.stdout?.on('data', (data: Buffer) => {
      combinedOutput += data.toString()
    })

    proc.stderr?.on('data', () => {
      // stderr handled via process completion
    })

    proc.on('close', (code) => {
      record.finishedAt = new Date().toISOString()
      record.exitCode = code ?? -1
      record.status = code === 0 ? 'success' : 'failed'
      record.output = combinedOutput.slice(-5000)

      if (code !== 0) {
        record.error = `Process exited with code ${code}`
      }

      resolve({
        record,
        stdout: combinedOutput,
        stderr: '',
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
      })
    })
  })
}
