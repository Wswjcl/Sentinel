import { Command } from 'commander'
import { TaskStore } from '@sentinel/core'
import chalk from 'chalk'

export const resumeCommand = new Command('resume')
  .description('Resume a paused task')
  .argument('<name>', 'Task name')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .action(async (name: string, options: { tasksDir: string }) => {
    const store = new TaskStore({ tasksDir: options.tasksDir })

    try {
      const info = await store.getTaskInfo(name)
      if (info.status !== 'paused') {
        console.log(chalk.gray(`Task "${name}" is not paused (current status: ${info.status})`))
        return
      }
    } catch {
      console.error(chalk.red(`Task "${name}" not found`))
      process.exit(1)
    }

    await store.setStatus(name, 'scheduled')
    console.log(chalk.green(`Task "${name}" resumed — scheduler will process it again`))
  })
