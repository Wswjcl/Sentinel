import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'

const WWC_CONFIG = `# WWC Configuration
tasks_dir: tasks
opencode_bin: opencode

# Scheduler defaults
scheduler:
  check_interval_ms: 60000
  concurrency: 3

# Default execution settings
defaults:
  model: ""
  agent: default
  timeout: 600
`

const TASK_TEMPLATE = `# Task Configuration
name: <task-name>
description: A brief description of what this task does
version: 1

schedule:
  type: cron
  expr: "0 9 * * *"
  timezone: Asia/Shanghai

execution:
  prompt: |
    Describe what you want the AI agent to do here.
    Be specific and provide context.
  model: ""
  agent: default
  timeout: 600
  retry:
    max: 2
    delay: 60
`

export const initCommand = new Command('init')
  .description('Initialize a new WWC project')
  .argument('[dir]', 'Project directory', '.')
  .option('--tasks-dir <dir>', 'Tasks directory', 'tasks')
  .option('--opencode-bin <path>', 'Path to opencode binary', 'opencode')
  .action(async (projectDir: string, options: { tasksDir: string; opencodeBin: string }) => {
    const root = isAbsolute(projectDir) ? projectDir : resolve(projectDir)

    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(join(root, options.tasksDir), { recursive: true })

    const configContent = WWC_CONFIG
      .replace('tasks_dir: tasks', `tasks_dir: ${options.tasksDir}`)
      .replace('opencode_bin: opencode', `opencode_bin: ${options.opencodeBin}`)

    await fs.writeFile(join(root, 'wwc.config.yaml'), configContent, 'utf-8')
    await fs.writeFile(join(root, '.gitignore'), 'tasks/*/output/\n.history.json\n', 'utf-8')

    console.log(`WWC project initialized at ${root}`)
    console.log(`  Tasks directory: ${join(root, options.tasksDir)}`)
    console.log(`  Config file: ${join(root, 'wwc.config.yaml')}`)
    console.log('\nNext step: wwc create <task-name>')
  })
