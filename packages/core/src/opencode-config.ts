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
  external_directory?: 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
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

export function generateOpenCodeConfig(
  taskConfig: TaskConfig,
  opts?: {
    permissions?: string[]
    denyTools?: string[]
  },
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

  if (!perm.external_directory) {
    perm.external_directory = 'deny'
  }

  if (opts?.denyTools) {
    for (const t of opts.denyTools) {
      ;(perm as Record<string, 'deny'>)[t] = 'deny'
    }
  }

  const config: OpenCodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    permission: perm,
    instructions: ['.opencode/AGENTS.md'],
    watcher: {
      ignore: ['output/**', '.history.json'],
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
    "ignore": ["output/**", ".history.json"]
  }
}
`
