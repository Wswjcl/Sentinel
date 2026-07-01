import { Command } from 'commander'
import { TaskStore, executeTask } from '@sentinel/core'
import chalk from 'chalk'

export const runCommand = new Command('run')
  .description('Run a task immediately')
  .argument('<name>', 'Task name')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .option('--dry', 'Dry run — show command without executing')
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
    console.log()

    if (options.dry) {
      console.log('Dry run — command would be:')
      console.log(`  opencode run --dir ${info.dir} "${config.execution.prompt}"`)
      return
    }

    const result = await executeTask({
      taskDir: info.dir,
      config,
    })

    const history = await store.getHistory(name)
    history.push(result.record)
    await store.saveHistory(name, history)

    // Update task status
    const newStatus = result.record.status === 'success' ? 'scheduled' : 'failed'
    await store.setStatus(name, newStatus)

    if (result.record.status === 'success') {
      console.log(chalk.green(`\nTask "${name}" completed successfully`))
      if (result.stdout) {
        console.log(chalk.gray('\nOutput (last 2000 chars):'))
        console.log(result.stdout.slice(-2000))
      }
    } else {
      console.log(chalk.red(`\nTask "${name}" failed (exit code: ${result.record.exitCode})`))
      if (result.record.error) {
        console.log(chalk.red(`  Error: ${result.record.error}`))
      }
    }
  })
