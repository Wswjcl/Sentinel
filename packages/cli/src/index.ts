#!/usr/bin/env node
import { Command } from 'commander'
import { createRequire } from 'node:module'
import { createCommand } from './commands/create.js'
import { listCommand } from './commands/list.js'
import { runCommand } from './commands/run.js'
import { deleteCommand } from './commands/delete.js'
import { schedulerCommand } from './commands/scheduler.js'
import { initCommand } from './commands/init.js'
import { pauseCommand } from './commands/pause.js'
import { resumeCommand } from './commands/resume.js'
import { flowCommand } from './commands/flow.js'

// Read the version from package.json at runtime (single source of truth)
const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

const program = new Command()

program
  .name('sentinel')
  .aliases(['wwc'])
  .description('AI-powered task scheduler — schedule tasks that run via OpenCode agents')
  .version(version)

program.addCommand(initCommand)
program.addCommand(createCommand)
program.addCommand(listCommand)
program.addCommand(runCommand)
program.addCommand(deleteCommand)
program.addCommand(pauseCommand)
program.addCommand(resumeCommand)
program.addCommand(schedulerCommand)
program.addCommand(flowCommand)

program.parse()
