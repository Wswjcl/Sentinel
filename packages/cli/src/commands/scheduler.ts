import { Command } from 'commander'
import { TaskStore, Scheduler } from '@wwc/core'
import chalk from 'chalk'

export const schedulerCommand = new Command('scheduler')
  .description('Manage the task scheduler daemon')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')

schedulerCommand
  .command('start')
  .description('Start the scheduler')
  .action(async (options: any) => {
    const parent = schedulerCommand.optsWithGlobals()
    const tasksDir = parent.tasksDir || 'tasks'

    const store = new TaskStore({ tasksDir })
    await store.init()

    const scheduler = new Scheduler({
      taskStore: store,
      concurrency: 3,
      checkIntervalMs: 60_000,
    })

    scheduler.setLogger((level, msg) => {
      const prefix = {
        info: chalk.blue('[INFO]'),
        warn: chalk.yellow('[WARN]'),
        error: chalk.red('[ERROR]'),
        debug: chalk.gray('[DEBUG]'),
      }[level] ?? chalk.gray(`[${level}]`)
      console.log(`${prefix} ${new Date().toISOString()} ${msg}`)
    })

    scheduler.start()
    console.log(chalk.green('Scheduler started. Press Ctrl+C to stop.'))

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nShutting down...'))
      scheduler.stop()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      scheduler.stop()
      process.exit(0)
    })
  })

schedulerCommand
  .command('status')
  .description('Show scheduler status')
  .action(async (options: any) => {
    console.log(chalk.yellow('Scheduler status: not running'))
    console.log('Start with: wwc scheduler start')
  })
