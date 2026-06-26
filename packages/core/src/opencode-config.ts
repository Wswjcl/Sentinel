import type { TaskConfig } from '@wwc/core'

export interface OpenCodePermission {
  bash?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  edit?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  read?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  glob?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  grep?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  webfetch?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  websearch?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  skill?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  question?: 'allow' | 'ask' | 'deny'
  todowrite?: 'allow' | 'ask' | 'deny'
  task?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
  external_directory?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'deny'>
  doom_loop?: 'allow' | 'ask' | 'deny'
}

export interface OpenCodeConfig {
  $schema?: string
  model?: string
  default_agent?: string
  permission?: OpenCodePermission | 'allow' | 'ask' | 'deny'
  agent?: Record<string, {
    description?: string
    model?: string
    prompt?: string
    mode?: 'primary' | 'subagent' | 'all'
    permission?: OpenCodePermission
  }>
  mcp?: Record<string, unknown>
  tools?: Record<string, boolean>
  instructions?: string[]
  shell?: string
  formatter?: boolean | Record<string, unknown>
  snapshot?: boolean
  watcher?: { ignore?: string[] }
  experimental?: Record<string, unknown>
}

export interface ExternalDir {
  path: string
  permission: 'allow' | 'deny'
  read?: boolean
  write?: boolean
  exec?: boolean
}

export interface GenerateOpenCodeOpts {
  permissions?: string[]
  denyTools?: string[]
  externalDirs?: ExternalDir[]
  skills?: string[]
}

/** Normalize an external directory path for OpenCode config */
function normalizeExtPath(rawPath: string): string {
  // Convert backslashes to forward slashes
  let normalized = rawPath.replace(/\\/g, '/')
  // Ensure paths end with /** for recursive access
  if (normalized.includes('*')) {
    // Path already has glob — ensure it ends with **
    normalized = normalized.replace(/\*$/, '**')
  } else {
    // Plain path — append /**
    normalized = normalized.replace(/\/+$/, '') + '/**'
  }
  return normalized
}

export function generateOpenCodeConfig(
  taskConfig: TaskConfig,
  opts?: GenerateOpenCodeOpts,
): OpenCodeConfig {
  const exec = taskConfig.execution

  const perm: OpenCodePermission = {}

  if (opts?.permissions && opts.permissions.length > 0) {
    for (const p of opts.permissions) {
      ;(perm as Record<string, 'allow'>)[p] = 'allow'
    }
  } else {
    perm.bash = 'allow'
    perm.edit = 'allow'
    perm.read = 'allow'
    perm.glob = 'allow'
    perm.grep = 'allow'
    perm.webfetch = 'allow'
    perm.websearch = 'allow'
    perm.skill = 'allow'
    perm.todowrite = 'allow'
    perm.question = 'ask'
  }

  if (opts?.denyTools) {
    for (const t of opts.denyTools) {
      ;(perm as Record<string, 'deny'>)[t] = 'deny'
    }
  }

  // External directory access
  if (opts?.externalDirs && opts.externalDirs.length > 0) {
    const extDirs: Record<string, 'allow' | 'deny'> = {}
    const toolRestrictions: Record<string, Record<string, 'allow' | 'deny'>> = {}

    for (const ed of opts.externalDirs) {
      const normalized = normalizeExtPath(ed.path)
      extDirs[normalized] = ed.permission

      if (ed.permission === 'allow') {
        if (ed.read === false) {
          if (!toolRestrictions.read) toolRestrictions.read = {}
          toolRestrictions.read[normalized] = 'deny'
        }
        if (ed.write === false) {
          if (!toolRestrictions.edit) toolRestrictions.edit = {}
          toolRestrictions.edit[normalized] = 'deny'
        }
        if (ed.exec === false) {
          if (!toolRestrictions.bash) toolRestrictions.bash = {}
          toolRestrictions.bash[normalized] = 'deny'
        }
      }
    }

    perm.external_directory = extDirs

    for (const [tool, rules] of Object.entries(toolRestrictions)) {
      if (Object.keys(rules).length > 0) {
        ;(perm as Record<string, Record<string, 'allow' | 'deny'>>)[tool] = rules
      }
    }
  } else {
    perm.external_directory = 'deny'
  }

  const config: OpenCodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    permission: perm,
    instructions: ['.opencode/AGENTS.md'],
    watcher: {
      ignore: ['output/**', '.history.json', '.status.json'],
    },
  }

  if (exec.model) {
    config.model = exec.model
  }

  if (exec.agent && exec.agent !== 'default') {
    config.default_agent = exec.agent
  }

  return config
}

export function generateSkillContent(skillName: string, taskDesc: string): string {
  return `---
name: ${skillName}
description: Skill for task: ${taskDesc}
---

## What I do
- I assist with the "${skillName}" aspect of this task

## When to use me
Use this skill when the task requires ${skillName} functionality.

## Instructions
- Follow the task prompt closely
- Work within the configured permissions
- Save outputs to the output/ directory
`
}

export const OPENCODE_CONFIG_TEMPLATE = `{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "allow",
    "edit": "allow",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "skill": "allow",
    "todowrite": "allow",
    "question": "ask",
    "external_directory": "deny"
  },
  "instructions": [".opencode/AGENTS.md"],
  "watcher": {
    "ignore": ["output/**", ".history.json", ".status.json"]
  }
}
`
