import { Command } from 'commander'
import { TaskStore, getNextRun } from '@sentinel/core'
import chalk from 'chalk'

export const listCommand = new Command('list')
  .description('List all tasks')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .action(async (options: { tasksDir: string }) => {
    const store = new TaskStore({ tasksDir: options.tasksDir })

    const names = await store.listTasks()

    if (names.length === 0) {
      console.log('No tasks found. Create one with: sentinel create <name>')
      return
    }

    console.log(chalk.bold('\nTasks:\n'))

    for (const name of names) {
      try {
        const info = await store.getTaskInfo(name)
        const schedule = info.config.schedule

        let nextRunStr = '—'
        try {
          nextRunStr = getNextRun(schedule.expr, schedule.timezone).toLocaleString()
        } catch {}

        const statusIcon = {
          pending: chalk.gray('○'),
          scheduled: chalk.blue('●'),
          running: chalk.yellow('◉'),
          success: chalk.green('✓'),
          failed: chalk.red('✗'),
          paused: chalk.gray('⏸'),
          archived: chalk.gray('⏹'),
        }[info.status]

        console.log(
          `  ${statusIcon} ${chalk.bold(name)} — ${info.config.description}`,
        )
        console.log(`    Schedule: ${schedule.expr}  |  Next: ${nextRunStr}`)
        console.log(`    Status: ${info.status}  |  Runs: ${info.runCount}`)
        if (info.lastRun) {
          console.log(`    Last run: ${new Date(info.lastRun).toLocaleString()}`)
        }
        console.log()
      } catch (err) {
        console.log(`  ${chalk.red('✗')} ${chalk.bold(name)} — Error: ${String(err)}`)
        console.log()
      }
    }
  })
