#!/usr/bin/env node
import { Command } from 'commander'
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { runCommand } from './commands/run.js'
import { deleteCommand } from './commands/delete.js'
import { schedulerCommand } from './commands/scheduler.js'
import { initCommand } from './commands/init.js'
import { serveCommand } from './commands/serve.js'

const program = new Command()

program
  .name('wwc')
  .description('AI-powered task scheduler — schedule tasks that run via OpenCode agents')
  .version('0.1.0')

program.addCommand(initCommand)
program.addCommand(createCommand)
program.addCommand(listCommand)
program.addCommand(runCommand)
program.addCommand(deleteCommand)
program.addCommand(schedulerCommand)
program.addCommand(serveCommand)

program.parse()
