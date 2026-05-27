import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { isValidCron, generateOpenCodeConfig } from '@wwc/core'
import type { TaskConfig } from '@wwc/core'
import { createInterface, type Interface } from 'node:readline'

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer.trim()))
  })
}

const DEFAULT_TASKS_DIR = 'tasks'

const AVAILABLE_TOOLS = [
  'bash', 'read', 'edit', 'glob', 'grep',
  'webfetch', 'websearch', 'skill', 'todowrite', 'question',
]

export const createCommand = new Command('create')
  .description('Create a new task with OpenCode workspace')
  .argument('<name>', 'Task name')
  .option('--schedule <cron>', 'Cron schedule expression', '0 9 * * *')
  .option('--prompt <text>', 'Task prompt')
  .option('--model <model>', 'Model to use')
  .option('--agent <agent>', 'Agent name', 'default')
  .option('--timezone <tz>', 'Timezone', 'Asia/Shanghai')
  .option('--tasks-dir <dir>', 'Tasks directory', DEFAULT_TASKS_DIR)
  .option('--allow-tools <tools>', 'Comma-separated tools to allow (default: all)')
  .option('--deny-tools <tools>', 'Comma-separated tools to deny')
  .option('--external-dir <dir>', 'External directory to allow (deny by default)')
  .option('--interactive', 'Interactive mode', false)
  .action(async (name: string, options: any) => {
    const tasksDir = options.tasksDir
    const taskDir = join(tasksDir, name)

    try {
      await fs.access(taskDir)
      console.error(`Task "${name}" already exists at ${taskDir}`)
      process.exit(1)
    } catch {}

    let scheduleExpr = options.schedule
    let prompt = options.prompt || ''
    let desc = name
    let tz = options.timezone
    let model = options.model || ''
    let agent = options.agent || 'default'
    let allowTools: string[] | undefined
    let denyTools: string[] | undefined

    if (options.allowTools) {
      allowTools = options.allowTools.split(',').map((s: string) => s.trim().toLowerCase())
    }
    if (options.denyTools) {
      denyTools = options.denyTools.split(',').map((s: string) => s.trim().toLowerCase())
    }

    if (options.interactive) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })

      console.log('\n=== Create new task ===\n')
      desc = await ask(rl, 'Description: ') || name
      scheduleExpr = await ask(rl, `Cron schedule (default: ${options.schedule}): `) || options.schedule

      if (!isValidCron(scheduleExpr)) {
        console.error(`Invalid cron expression: ${scheduleExpr}`)
        rl.close()
        process.exit(1)
      }

      tz = await ask(rl, `Timezone (default: ${options.timezone}): `) || options.timezone
      prompt = await ask(rl, 'Prompt (what should the AI do?): ')
      model = await ask(rl, 'Model (press enter for default): ')
      agent = await ask(rl, 'Agent name (default): ') || 'default'

      const permChoice = await ask(rl, `Permission mode [allow-all | restrict] (default: allow-all): `)
      if (permChoice === 'restrict') {
        console.log(`\nAvailable tools: ${AVAILABLE_TOOLS.join(', ')}`)
        const selected = await ask(rl, 'Tools to allow (comma-separated, default all): ')
        if (selected) {
          allowTools = selected.split(',').map((s: string) => s.trim().toLowerCase())
        }
        const denied = await ask(rl, 'Tools to deny (comma-separated): ')
        if (denied) {
          denyTools = denied.split(',').map((s: string) => s.trim().toLowerCase())
        }
      }

      rl.close()
    }

    if (!isValidCron(scheduleExpr)) {
      console.error(`Invalid cron expression: ${scheduleExpr}`)
      process.exit(1)
    }

    const taskConfig: TaskConfig = {
      name,
      description: desc || name,
      version: 1,
      schedule: {
        type: 'cron',
        expr: scheduleExpr,
        timezone: tz,
      },
      execution: {
        prompt: prompt || 'No prompt specified',
        model: model || undefined,
        agent: agent || 'default',
        timeout: 600,
        retry: { max: 2, delay: 60 },
      },
    }

    const opencodeConfig = generateOpenCodeConfig(taskConfig, {
      permissions: allowTools,
      denyTools,
    })

    // Create directory structure
    await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
    await fs.mkdir(join(taskDir, '.opencode', 'agents'), { recursive: true })
    await fs.mkdir(join(taskDir, 'scripts'), { recursive: true })
    await fs.mkdir(join(taskDir, 'output'), { recursive: true })

    // Write task.yaml
    await fs.writeFile(join(taskDir, 'task.yaml'), stringify(taskConfig), 'utf-8')

    // Write .opencode/opencode.json
    await fs.writeFile(
      join(taskDir, '.opencode', 'opencode.json'),
      JSON.stringify(opencodeConfig, null, 2),
      'utf-8',
    )

    // Write .opencode/AGENTS.md
    await fs.writeFile(
      join(taskDir, '.opencode', 'AGENTS.md'),
      `# ${name}\n\n${desc}\n\nThis task is managed by WWC scheduler.\n`,
      'utf-8',
    )

    console.log(`\nTask "${name}" created at ${taskDir}`)
    console.log(`  task.yaml      — schedule + prompt`)
    console.log(`  opencode.json  — permissions + tools config`)
    console.log(`  AGENTS.md      — task rules for AI`)
    console.log(`  skills/        — project-level skills`)
    console.log(`  scripts/       — helper scripts`)
    console.log(`  output/        — execution output`)
    console.log(`\n  Schedule: ${scheduleExpr}`)
    if (allowTools) console.log(`  Allowed tools: ${allowTools.join(', ')}`)
    if (denyTools) console.log(`  Denied tools: ${denyTools.join(', ')}`)
  })
