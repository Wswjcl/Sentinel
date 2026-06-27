import { Command } from 'commander'
import { TaskStore } from '@sentinel/core'
import chalk from 'chalk'

export const deleteCommand = new Command('delete')
  .description('Delete a task')
  .argument('<name>', 'Task name')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .option('--force', 'Skip confirmation', false)
  .action(async (name: string, options: { tasksDir: string; force?: boolean }) => {
    const store = new TaskStore({ tasksDir: options.tasksDir })

    try {
      await store.getConfig(name)
    } catch {
      console.error(chalk.red(`Task "${name}" not found`))
      process.exit(1)
    }

    if (!options.force) {
      console.log(chalk.yellow(`This will permanently delete task "${name}" and all its data.`))
      console.log('Use --force to skip this confirmation.')
      process.exit(0)
    }

    await store.deleteTask(name)
    console.log(chalk.green(`Task "${name}" deleted`))
  })
