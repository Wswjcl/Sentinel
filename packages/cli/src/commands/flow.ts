import { Command } from 'commander'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { stringify, parse as parseYaml } from 'yaml'
import {
  FlowStore, TaskStore, FlowEngine, validateFlow, loadConfig,
  type FlowConfig, type FlowRun,
} from '@sentinel/core'
import chalk from 'chalk'

const DEFAULT_FLOWS_DIR = 'flows'

const FLOW_TEMPLATE = `# Flow Configuration - a DAG of task nodes
name: <flow-name>
description: What this workflow produces
version: 1

# Optional whole-flow schedule - the scheduler triggers the flow when due
schedule:
  type: cron
  expr: "0 8 * * *"
  timezone: Asia/Shanghai

# Max nodes running in parallel (default 3)
concurrency: 3

# Wall-clock budget for the whole flow in seconds - when exceeded,
# no further nodes start
# maxTotalSeconds: 3600

nodes:
  # AI node - references an existing task workspace. Nodes without
  # shared dependencies run in parallel automatically.
  collect:
    type: ai
    task: my-collect-task

  # Script node - deterministic shell step (POSIX sh syntax)
  process:
    type: script
    run: "echo processing {collect.output} > output/processed.txt"
    needs: [collect]

  # Conditional edge - compensation branch that only runs when the
  # upstream FAILS ({ node, on: success | failure | finished })
  # alert:
  #   type: script
  #   run: "echo process failed"
  #   needs: [{ node: process, on: failure }]

  # Manual node - human gate; with aiTakeover the agent handles it
  review:
    type: manual
    aiTakeover: true
    takeoverPrompt: Review output/processed.txt and fix any issues.
    needs: [process]
`

function parseInputs(pairs: string[]): Record<string, string> {
  const inputs: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      console.error(chalk.red(`Invalid --input "${pair}" (expected key=value)`))
      process.exit(1)
    }
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return inputs
}

async function parseInputsFile(path: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(path, 'utf-8')
  const parsed = parseYaml(raw) as Record<string, unknown>
  const inputs: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed ?? {})) {
    inputs[k] = String(v)
  }
  return inputs
}

function printRun(run: FlowRun): void {
  const statusColor = {
    success: chalk.green, failed: chalk.red, partial: chalk.yellow, running: chalk.blue,
  }[run.status] ?? chalk.gray
  console.log(`  ${statusColor(`[${run.status}]`)} run ${run.id.slice(0, 8)}  started ${run.startedAt}${run.finishedAt ? `  finished ${run.finishedAt}` : ''}`)
  for (const nr of Object.values(run.nodes)) {
    const icon = { success: '✓', failed: '✗', running: '◉', pending: '○', skipped: '⏭' }[nr.status]
    const color = { success: chalk.green, failed: chalk.red, running: chalk.blue, pending: chalk.gray, skipped: chalk.gray }[nr.status] ?? chalk.gray
    console.log(`    ${color(`${icon} ${nr.node}`)} (${nr.type})${nr.error ? chalk.red(` - ${nr.error.slice(0, 120)}`) : ''}`)
  }
}

export const flowCommand = new Command('flow')
  .description('Manage task flow graphs (DAG workflows)')
  .option('--flows-dir <dir>', 'Parent flows directory', DEFAULT_FLOWS_DIR)
  .option('--tasks-dir <dir>', 'Tasks directory (for ai node lookups)', 'tasks')

flowCommand
  .command('create')
  .description('Scaffold a new flow with a template flow.yaml')
  .argument('<name>', 'Flow name')
  .action(async (name: string) => {
    const parent = flowCommand.optsWithGlobals()
    const appConfig = await loadConfig()
    const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
    const dir = join(flowsDir, name)

    try {
      await fs.access(join(dir, 'flow.yaml'))
      console.error(`Flow already exists at ${dir}`)
      process.exit(1)
    } catch {}

    await fs.mkdir(join(dir, 'output'), { recursive: true })
    await fs.writeFile(join(dir, 'flow.yaml'), FLOW_TEMPLATE.replaceAll('<flow-name>', name), 'utf-8')
    console.log(`Flow "${name}" scaffolded at ${dir}`)
    console.log('Edit flow.yaml, then: sentinel flow validate ' + name)
  })

flowCommand
  .command('validate')
  .description('Validate a flow config')
  .argument('<name>', 'Flow name')
  .option('--file <path>', 'Validate a standalone flow.yaml file instead')
  .action(async (name: string, options: { file?: string }) => {
    let config: FlowConfig
    if (options.file) {
      const raw = await fs.readFile(options.file, 'utf-8')
      config = parseYaml(raw) as FlowConfig
    } else {
      const parent = flowCommand.optsWithGlobals()
      const appConfig = await loadConfig()
      const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
      const store = new FlowStore({ flowsDir })
      config = await store.getConfig(name)
    }

    const result = validateFlow(config)
    if (result.valid) {
      console.log(chalk.green(`Flow "${config.name}" is valid (${Object.keys(config.nodes ?? {}).length} nodes)`))
    } else {
      console.error(chalk.red(`Flow "${config.name}" is invalid:`))
      for (const err of result.errors) console.error(chalk.red(`  - ${err}`))
      process.exit(1)
    }
  })

flowCommand
  .command('list')
  .description('List all flows with their last run status')
  .action(async () => {
    const parent = flowCommand.optsWithGlobals()
    const appConfig = await loadConfig()
    const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
    const store = new FlowStore({ flowsDir })

    const names = await store.listFlows()
    if (names.length === 0) {
      console.log('No flows found. Create one with: sentinel flow create <name>')
      return
    }

    console.log(chalk.bold('\nFlows:\n'))
    for (const name of names) {
      try {
        const config = await store.getConfig(name)
        const runs = await store.getRuns(name)
        const last = runs[runs.length - 1]
        const nodeCount = Object.keys(config.nodes ?? {}).length
        const schedule = config.schedule ? `${config.schedule.type}: ${config.schedule.expr}` : 'manual'
        console.log(`  ${chalk.bold(name)} - ${config.description ?? ''}`)
        console.log(`    Nodes: ${nodeCount}  |  Schedule: ${schedule}  |  Runs: ${runs.length}`)
        if (last) console.log(`    Last run: ${last.status} at ${last.startedAt}`)
        console.log()
      } catch (err) {
        console.log(`  ${chalk.red('✗')} ${chalk.bold(name)} - Error: ${String(err)}`)
        console.log()
      }
    }
  })

flowCommand
  .command('run')
  .description('Run a flow immediately and wait for completion')
  .argument('<name>', 'Flow name')
  .option('--input <key=value>', 'Run input (repeatable, referenced as {inputs.key})', (v: string, prev: string[]) => [...(prev || []), v], [] as string[])
  .option('--inputs-file <path>', 'YAML/JSON file of run inputs (merged with --input)')
  .option('--resume [runId]', 'Resume a previous run - successful nodes are reused (default: latest run)')
  .action(async (name: string, options: { input: string[]; inputsFile?: string; resume?: string | boolean }) => {
    const parent = flowCommand.optsWithGlobals()
    const appConfig = await loadConfig()
    const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
    const tasksDir = parent.tasksDir || appConfig.tasks_dir || 'tasks'

    const flowStore = new FlowStore({ flowsDir })
    const taskStore = new TaskStore({ tasksDir })
    const engine = new FlowEngine({
      flowStore,
      taskStore,
      opencodeBin: appConfig.opencode_bin,
      onLog: (level, msg) => {
        if (level === 'error') console.error(chalk.red(`  [${level}] ${msg}`))
        else console.log(chalk.gray(`  [${level}] ${msg}`))
      },
    })

    // Merge --input pairs with --inputs-file (file first, flags win)
    const inputs = options.inputsFile
      ? await parseInputsFile(options.inputsFile)
      : {}
    Object.assign(inputs, parseInputs(options.input))

    let resumeFromRunId: string | undefined
    if (options.resume) {
      const runs = await flowStore.getRuns(name)
      if (runs.length === 0) {
        console.error(chalk.red(`No previous runs for flow "${name}" - nothing to resume`))
        process.exit(1)
      }
      const needle = typeof options.resume === 'string' ? options.resume : null
      const prev = needle
        ? runs.find((r) => r.id === needle || r.id.startsWith(needle))
        : runs[runs.length - 1]
      if (!prev) {
        console.error(chalk.red(`Run "${needle}" not found for flow "${name}"`))
        process.exit(1)
      }
      resumeFromRunId = prev.id
    }

    console.log(chalk.bold(`\nRunning flow: ${name}${resumeFromRunId ? chalk.yellow(' (resumed)') : ''}`))
    const run = await engine.run(name, { inputs, resumeFromRunId })
    printRun(run)
    if (run.status !== 'success') process.exitCode = 1
  })

flowCommand
  .command('clone')
  .description('Clone a flow under a new name with empty run history')
  .argument('<source>', 'Source flow name')
  .argument('<target>', 'New flow name')
  .action(async (source: string, target: string) => {
    const parent = flowCommand.optsWithGlobals()
    const appConfig = await loadConfig()
    const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
    const store = new FlowStore({ flowsDir })
    try {
      await store.cloneFlow(source, target)
      console.log(`Flow "${source}" cloned to "${target}"`)
      console.log(`  Run it with: sentinel flow run ${target} --input key=value`)
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)))
      process.exit(1)
    }
  })

flowCommand
  .command('status')
  .description('Show recent runs of a flow')
  .argument('<name>', 'Flow name')
  .option('--runs <n>', 'Number of runs to show', '5')
  .action(async (name: string, options: { runs: string }) => {
    const parent = flowCommand.optsWithGlobals()
    const appConfig = await loadConfig()
    const flowsDir = parent.flowsDir || appConfig.flows_dir || DEFAULT_FLOWS_DIR
    const store = new FlowStore({ flowsDir })

    const runs = await store.getRuns(name)
    if (runs.length === 0) {
      console.log(`No runs recorded for flow "${name}". Run it: sentinel flow run ${name}`)
      return
    }

    const count = Math.min(parseInt(options.runs, 10) || 5, runs.length)
    console.log(chalk.bold(`\nFlow "${name}" - last ${count} run(s):\n`))
    for (const run of runs.slice(-count).reverse()) printRun(run)
  })
