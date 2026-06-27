import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { stringify } from 'yaml'
import { isValidCron, generateOpenCodeConfig, generateSkillContent } from '@sentinel/core'
import type { TaskConfig, ExternalDir } from '@sentinel/core'
import { createInterface, type Interface } from 'node:readline'

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer.trim()))
  })
}

const DEFAULT_TASKS_DIR = 'tasks'

const AVAILABLE_TOOLS = [
  'bash', 'read', 'edit', 'glob', 'grep',
  'webfetch', 'websearch', 'skill', 'todowrite', 'question',
]

function parseExternalDir(input: string): ExternalDir | null {
  const parts = input.split(':')
  let path: string
  let permStart = 1

  // Handle Windows drive letter (e.g. "D:/Projects" -> parts = ["D", "/Projects", ...])
  if (parts.length > 1 && /^[A-Za-z]$/.test(parts[0]) && /^[/\\]/.test(parts[1] || '')) {
    path = parts[0] + ':' + parts[1]
    permStart = 2
  } else {
    path = parts[0]
  }

  if (!path) return null

  const ext: ExternalDir = { path, permission: 'allow', read: true, write: true, exec: true }

  for (let i = permStart; i < parts.length; i++) {
    const p = parts[i].toLowerCase()
    if (p === 'allow' || p === 'deny') {
      ext.permission = p
      if (p === 'deny') {
        ext.read = false
        ext.write = false
        ext.exec = false
      }
    } else if (p === 'r') ext.read = true
    else if (p === 'w') ext.write = true
    else if (p === 'x') ext.exec = true
    else if (p === 'rw') { ext.read = true; ext.write = true }
    else if (p === 'rwx') { ext.read = true; ext.write = true; ext.exec = true }
    else if (p === 'ro') { ext.read = true; ext.write = false; ext.exec = false }
  }

  return ext
}

export const createCommand = new Command('create')
  .description('Create a new task workspace directory')
  .argument('<name>', 'Task name')
  .option('--project-dir <path>', 'Custom project directory path (default: tasks/<name>)')
  .option('--schedule <cron>', 'Cron schedule expression', '0 9 * * *')
  .option('--prompt <text>', 'Task prompt')
  .option('--model <model>', 'Model to use')
  .option('--agent <agent>', 'Agent name', 'default')
  .option('--timezone <tz>', 'Timezone', 'Asia/Shanghai')
  .option('--tasks-dir <dir>', 'Parent tasks directory', DEFAULT_TASKS_DIR)
  .option('--allow-tools <tools>', 'Comma-separated tools to allow')
  .option('--deny-tools <tools>', 'Comma-separated tools to deny')
  .option('--skills <skills>', 'Comma-separated skill names to create')
  .option('--external-dir <path:perm:rw>', 'External directory access (repeatable)', (v: string, prev: string[]) => [...(prev || []), v], [] as string[])
  .option('--interactive', 'Interactive mode', false)
  .action(async (name: string, options: {
    projectDir?: string
    schedule: string
    prompt?: string
    model?: string
    agent: string
    timezone: string
    tasksDir: string
    allowTools?: string
    denyTools?: string
    skills?: string
    externalDir: string[]
    interactive: boolean
  }) => {
    const tasksDir = options.tasksDir
    const taskDir = options.projectDir
      ? (isAbsolute(options.projectDir) ? options.projectDir : resolve(options.projectDir))
      : join(tasksDir, name)

    try {
      await fs.access(taskDir)
      console.error(`Workspace already exists at ${taskDir}`)
      process.exit(1)
    } catch {}

    let scheduleExpr = options.schedule
    let prompt = options.prompt || ''
    let desc = name
    let tz = options.timezone
    let model = options.model || ''
    let agent = options.agent || 'default'
    let allowTools: string[] | undefined
    let denyTools: string[] | undefined
    let skillNames: string[] | undefined
    let externalDirs: ExternalDir[] | undefined

    if (options.allowTools) {
      allowTools = options.allowTools.split(',').map((s: string) => s.trim().toLowerCase())
    }
    if (options.denyTools) {
      denyTools = options.denyTools.split(',').map((s: string) => s.trim().toLowerCase())
    }
    if (options.skills) {
      skillNames = options.skills.split(',').map((s: string) => s.trim().toLowerCase())
    }
    if (options.externalDir && options.externalDir.length > 0) {
      externalDirs = options.externalDir.map(parseExternalDir).filter(Boolean) as ExternalDir[]
    }

    if (options.interactive) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })

      console.log('\n=== Create new workspace ===\n')
      desc = await ask(rl, 'Description: ') || name

      const projDir = await ask(rl, `Project directory (default: ${taskDir}): `)
      if (projDir) {
        const p = isAbsolute(projDir) ? projDir : resolve(projDir)
        // Reassign to a new variable since we can't change const
        // We'll use it below
        ; (options as any)._interactiveDir = p
      }

      scheduleExpr = await ask(rl, `Cron schedule (default: ${options.schedule}): `) || options.schedule

      if (!isValidCron(scheduleExpr)) {
        console.error(`Invalid cron expression: ${scheduleExpr}`)
        rl.close()
        process.exit(1)
      }

      tz = await ask(rl, `Timezone (default: ${options.timezone}): `) || options.timezone
      prompt = await ask(rl, 'Prompt (what should the AI do?): ')
      model = await ask(rl, 'Model (press enter for default): ')
      agent = await ask(rl, 'Agent name (default): ') || 'default'

      const skillsInput = await ask(rl, 'Skills to create (comma-separated, optional): ')
      if (skillsInput) {
        skillNames = skillsInput.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      }

      const extInput = await ask(rl, 'External directories (e.g. /data:allow:rw, repeatable, enter to skip): ')
      if (extInput) {
        externalDirs = extInput.split(',').map(parseExternalDir).filter(Boolean) as ExternalDir[]
      }

      const permChoice = await ask(rl, `Permission mode [allow-all | restrict] (default: allow-all): `)
      if (permChoice === 'restrict') {
        console.log(`\nAvailable tools: ${AVAILABLE_TOOLS.join(', ')}`)
        const selected = await ask(rl, 'Tools to allow (comma-separated, default all): ')
        if (selected) {
          allowTools = selected.split(',').map((s: string) => s.trim().toLowerCase())
        }
        const denied = await ask(rl, 'Tools to deny (comma-separated): ')
        if (denied) {
          denyTools = denied.split(',').map((s: string) => s.trim().toLowerCase())
        }
      }

      rl.close()

      if ((options as any)._interactiveDir) {
        // Use the interactive dir
        const finalDir = (options as any)._interactiveDir
        await createWorkspace(finalDir, name, desc, scheduleExpr, tz, prompt, model, agent, allowTools, denyTools, skillNames, externalDirs)
        return
      }
    }

    if (!isValidCron(scheduleExpr)) {
      console.error(`Invalid cron expression: ${scheduleExpr}`)
      process.exit(1)
    }

    await createWorkspace(taskDir, name, desc, scheduleExpr, tz, prompt, model, agent, allowTools, denyTools, skillNames, externalDirs)
  })

async function createWorkspace(
  taskDir: string,
  name: string,
  desc: string,
  scheduleExpr: string,
  tz: string,
  prompt: string,
  model: string,
  agent: string,
  allowTools: string[] | undefined,
  denyTools: string[] | undefined,
  skillNames: string[] | undefined,
  externalDirs: ExternalDir[] | undefined,
) {
  const taskConfig: TaskConfig = {
    name,
    description: desc || name,
    version: 1,
    schedule: {
      type: 'cron',
      expr: scheduleExpr,
      timezone: tz,
    },
    execution: {
      prompt: prompt || 'No prompt specified',
      model: model || undefined,
      agent: agent || 'default',
      timeout: 600,
      retry: { max: 2, delay: 60 },
    },
  }

  const opencodeConfig = generateOpenCodeConfig(taskConfig, {
    permissions: allowTools,
    denyTools,
    externalDirs,
    skills: skillNames,
  })

  // Create directory structure
  await fs.mkdir(join(taskDir, '.opencode', 'skills'), { recursive: true })
  await fs.mkdir(join(taskDir, '.opencode', 'agents'), { recursive: true })
  await fs.mkdir(join(taskDir, 'scripts'), { recursive: true })
  await fs.mkdir(join(taskDir, 'output'), { recursive: true })

  // Write task.yaml
  await fs.writeFile(join(taskDir, 'task.yaml'), stringify(taskConfig), 'utf-8')

  // Write opencode.json
  await fs.writeFile(
    join(taskDir, '.opencode', 'opencode.json'),
    JSON.stringify(opencodeConfig, null, 2),
    'utf-8',
  )

  // Write AGENTS.md
  await fs.writeFile(
    join(taskDir, '.opencode', 'AGENTS.md'),
    `# ${name}\n\n${desc}\n\nThis workspace is managed by Sentinel scheduler.\n`,
    'utf-8',
  )

  // Create skill files
  if (skillNames && skillNames.length > 0) {
    for (const skillName of skillNames) {
      const skillDir = join(taskDir, '.opencode', 'skills', skillName)
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(
        join(skillDir, 'SKILL.md'),
        generateSkillContent(skillName, desc),
        'utf-8',
      )
    }
  }

  console.log(`\nWorkspace "${name}" created at ${taskDir}`)
  console.log(`  Schedule:      ${scheduleExpr}`)
  console.log(`  Model:         ${model || 'default'}`)
  console.log(`  Agent:         ${agent}`)
  if (skillNames && skillNames.length > 0) console.log(`  Skills:        ${skillNames.join(', ')}`)
  if (externalDirs && externalDirs.length > 0) {
    console.log(`  External dirs:`)
    for (const ed of externalDirs) {
      const flags = [ed.read ? 'r' : '', ed.write ? 'w' : '', ed.exec ? 'x' : ''].join('')
      console.log(`    ${ed.path} [${ed.permission}]${flags ? ` (${flags})` : ''}`)
    }
  }
  if (allowTools) console.log(`  Allowed tools:  ${allowTools.join(', ')}`)
  if (denyTools) console.log(`  Denied tools:   ${denyTools.join(', ')}`)
}
