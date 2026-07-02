import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

export interface SentinelAppConfig {
  tasks_dir?: string
  opencode_bin?: string
  scheduler?: {
    check_interval_ms?: number
    concurrency?: number
  }
  defaults?: {
    model?: string
    agent?: string
    timeout?: number
    retry?: {
      max?: number
      delay?: number
    }
  }
}

/**
 * Load sentinel.config.yaml from the given directory (or cwd).
 * Returns a parsed config object, or an empty object if the file doesn't exist.
 */
export async function loadConfig(cwd?: string): Promise<SentinelAppConfig> {
  const dir = cwd ?? process.cwd()
  const configPath = join(dir, 'sentinel.config.yaml')

  try {
    const content = await fs.readFile(configPath, 'utf-8')
    // Parse YAML without adding a dependency — use simple regex parsing
    // for the flat + 1-level-nested structure we generate
    return parseSimpleYaml(content)
  } catch {
    return {}
  }
}

/**
 * Simple YAML parser for sentinel.config.yaml structure.
 * Handles: top-level keys, nested objects (scheduler/defaults), and nested retry.
 */
function parseSimpleYaml(content: string): SentinelAppConfig {
  const config: SentinelAppConfig = {}
  const lines = content.split('\n')

  let currentSection: string | null = null
  let currentSubSection: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue

    // Top-level key
    if (!line.startsWith(' ')) {
      currentSection = null
      currentSubSection = null
      const match = /^(\w+):\s*(.*)$/.exec(line.trim())
      if (match) {
        const key = match[1]
        const value = match[2].trim()
        if (value === '') {
          // This is a section header (e.g. "scheduler:" or "defaults:")
          currentSection = key
          if (key === 'scheduler') config.scheduler = {}
          if (key === 'defaults') config.defaults = {}
        } else {
          ;(config as any)[key] = parseValue(value)
        }
      }
    }
    // First-level indent (2 spaces)
    else if (line.startsWith('  ') && !line.startsWith('    ')) {
      currentSubSection = null
      const match = /^  (\w+):\s*(.*)$/.exec(line)
      if (match && currentSection) {
        const key = match[1]
        const value = match[2].trim()
        if (value === '') {
          currentSubSection = key
          if (currentSection === 'defaults' && key === 'retry') {
            config.defaults!.retry = {}
          }
        } else {
          const section = config[currentSection as keyof SentinelAppConfig] as any
          if (section) section[key] = parseValue(value)
        }
      }
    }
    // Second-level indent (4 spaces)
    else if (line.startsWith('    ')) {
      const match = /^    (\w+):\s*(.*)$/.exec(line)
      if (match && currentSection === 'defaults' && currentSubSection === 'retry') {
        const key = match[1]
        const value = parseValue(match[2].trim())
        config.defaults!.retry![key as 'max' | 'delay'] = value as number
      }
    }
  }

  return config
}

function parseValue(value: string): string | number | boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
