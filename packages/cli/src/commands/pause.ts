import { Command } from 'commander'
import { TaskStore } from '@sentinel/core'
import chalk from 'chalk'

export const pauseCommand = new Command('pause')
  .description('Pause a task (scheduler will skip it)')
  .argument('<name>', 'Task name')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .action(async (name: string, options: { tasksDir: string }) => {
    const store = new TaskStore({ tasksDir: options.tasksDir })

    try {
      await store.getTaskInfo(name)
    } catch {
      console.error(chalk.red(`Task "${name}" not found`))
      process.exit(1)
    }

    await store.setStatus(name, 'paused')
    console.log(chalk.yellow(`Task "${name}" paused — scheduler will skip it`))
  })
