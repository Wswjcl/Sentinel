import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { isValidCron } from '@wwc/core'
import { createInterface, type Interface } from 'node:readline'

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer.trim()))
  })
}

const DEFAULT_TASKS_DIR = 'tasks'

export const createCommand = new Command('create')
  .description('Create a new task')
  .argument('<name>', 'Task name')
  .option('--schedule <cron>', 'Cron schedule expression', '0 9 * * *')
  .option('--prompt <text>', 'Task prompt')
  .option('--model <model>', 'Model to use')
  .option('--timezone <tz>', 'Timezone', 'Asia/Shanghai')
  .option('--tasks-dir <dir>', 'Tasks directory', DEFAULT_TASKS_DIR)
  .option('--interactive', 'Interactive mode', false)
  .action(async (name: string, options: any) => {
    const tasksDir = options.tasksDir
    const taskDir = join(tasksDir, name)

    try {
      await fs.access(taskDir)
      console.error(`Task "${name}" already exists at ${taskDir}`)
      process.exit(1)
    } catch {}

    if (options.interactive) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })

      console.log('\n=== Create new task ===\n')
      const desc = await ask(rl, 'Description: ')
      let scheduleExpr = await ask(rl, `Cron schedule (default: ${options.schedule}): `)
      if (!scheduleExpr) scheduleExpr = options.schedule

      if (!isValidCron(scheduleExpr)) {
        console.error(`Invalid cron expression: ${scheduleExpr}`)
        rl.close()
        process.exit(1)
      }

      const timezone = await ask(rl, `Timezone (default: ${options.timezone}): `)
      const prompt = await ask(rl, 'Prompt (what should the AI do?): ')
      const model = await ask(rl, 'Model (press enter for default): ')
      const agent = await ask(rl, 'Agent (press enter for default): ')

      rl.close()

      const config = {
        name,
        description: desc || name,
        version: 1,
        schedule: {
          type: 'cron',
          expr: scheduleExpr,
          timezone: timezone || options.timezone,
        },
        execution: {
          prompt: prompt || '',
          model: model || undefined,
          agent: agent || 'default',
          timeout: 600,
          retry: { max: 2, delay: 60 },
        },
      }

      await fs.mkdir(taskDir, { recursive: true })
      await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
      await fs.writeFile(join(taskDir, 'task.yaml'), stringify(config), 'utf-8')

      console.log(`\nTask "${name}" created at ${taskDir}`)
      console.log('  Edit task: wwc edit ' + name)
      console.log('  Run once:  wwc run ' + name)
    } else {
      if (!isValidCron(options.schedule)) {
        console.error(`Invalid cron expression: ${options.schedule}`)
        process.exit(1)
      }

      const config = {
        name,
        description: name,
        version: 1,
        schedule: {
          type: 'cron' as const,
          expr: options.schedule,
          timezone: options.timezone,
        },
        execution: {
          prompt: options.prompt || 'No prompt specified',
          model: options.model || undefined,
          agent: options.agent || 'default',
          timeout: 600,
          retry: { max: 2, delay: 60 },
        },
      }

      await fs.mkdir(taskDir, { recursive: true })
      await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
      await fs.writeFile(join(taskDir, 'task.yaml'), stringify(config), 'utf-8')

      console.log(`Task "${name}" created at ${taskDir}`)
      console.log(`  Schedule: ${options.schedule}`)
    }
  })
