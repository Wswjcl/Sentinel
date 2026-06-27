#!/usr/bin/env node
import { Command } from 'commander'
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { runCommand } from './commands/run.js'
import { deleteCommand } from './commands/delete.js'
import { schedulerCommand } from './commands/scheduler.js'
import { initCommand } from './commands/init.js'

const program = new Command()

program
  .name('sentinel')
  .aliases(['wwc'])
  .description('AI-powered task scheduler — schedule tasks that run via OpenCode agents')
  .version('1.0.0')

program.addCommand(initCommand)
program.addCommand(createCommand)
program.addCommand(listCommand)
program.addCommand(runCommand)
program.addCommand(deleteCommand)
program.addCommand(schedulerCommand)

program.parse()
