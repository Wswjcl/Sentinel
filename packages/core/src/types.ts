export interface TaskSchedule {
  type: 'cron' | 'interval' | 'once'
  expr: string
  timezone?: string
}

export interface TaskExecution {
  prompt: string
  model?: string
  agent?: string
  skills?: string[]
  timeout?: number
  retry?: {
    max: number
    delay: number
  }
}

export interface TaskNotify {
  on_success?: 'webhook' | 'none'
  on_failure?: 'webhook' | 'none'
  webhook_url?: string
}

export interface TaskConfig {
  name: string
  description: string
  version: number
  schedule: TaskSchedule
  execution: TaskExecution
  notify?: TaskNotify
}

export type TaskStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'
  | 'archived'

export interface TaskRunRecord {
  id: string
  taskName: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'failed'
  exitCode?: number
  error?: string
  output?: string
}

export interface TaskInfo {
  config: TaskConfig
  dir: string
  status: TaskStatus
  lastRun?: string
  nextRun?: string
  runCount: number
  history: TaskRunRecord[]
}
