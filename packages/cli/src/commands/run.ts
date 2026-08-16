import { Command } from 'commander'
import { TaskStore, runTaskExecution } from '@sentinel/core'
import chalk from 'chalk'

export const runCommand = new Command('run')
  .description('Run a task immediately')
  .argument('<name>', 'Task name')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .option('--dry', 'Dry run - show command without executing')
  .action(async (name: string, options: { tasksDir: string; dry?: boolean }) => {
    const store = new TaskStore({ tasksDir: options.tasksDir })

    let info
    try {
      info = await store.getTaskInfo(name)
    } catch (err) {
      console.error(chalk.red(`Task "${name}" not found`))
      process.exit(1)
    }

    const { config } = info
    console.log(chalk.bold(`\nRunning task: ${name}`))
    console.log(`  Directory: ${info.dir}`)
    console.log(`  Prompt: ${config.execution.prompt.slice(0, 100)}...`)
    if (config.agentLoop?.enabled) {
      console.log(`  Agent Loop: on (max ${config.agentLoop.maxIterations ?? 3} iterations, ${config.agentLoop.verification.type} verification)`)
    }
    console.log()

    if (options.dry) {
      console.log('Dry run - command would be:')
      console.log(`  opencode run --dir ${info.dir} "${config.execution.prompt}"`)
      return
    }

    // Same execution path as the scheduler: agent loop when enabled,
    // bounded retries otherwise, plus history persistence, status
    // transitions and webhook notifications.
    const outcome = await runTaskExecution({
      taskStore: store,
      name,
      info,
      onLog: (level, msg) => {
        if (level === 'error') console.error(chalk.red(`  [${level}] ${msg}`))
        else console.log(chalk.gray(`  [${level}] ${msg}`))
      },
    })

    if (outcome.loopResult) {
      console.log(`  Loop iterations: ${outcome.loopResult.iterations}`)
    }

    if (outcome.ok) {
      console.log(chalk.green(`\nTask "${name}" completed successfully`))
      if (outcome.lastRecord?.output) {
        console.log(chalk.gray('\nOutput (last 2000 chars):'))
        console.log(outcome.lastRecord.output.slice(-2000))
      }
    } else {
      console.log(chalk.red(`\nTask "${name}" failed (exit code: ${outcome.lastRecord?.exitCode})`))
      if (outcome.lastRecord?.error) {
        console.log(chalk.red(`  Error: ${outcome.lastRecord.error}`))
      }
    }
  })
