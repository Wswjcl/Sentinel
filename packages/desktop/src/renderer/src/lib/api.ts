/**
 * Type-safe IPC wrapper — thin convenience layer over window.api.
 * Centralises all renderer→main calls so components never access
 * window.api directly (easier to mock in tests, single import site).
 */

import type {
  TaskInfo,
  TaskRunRecord,
  TaskStatus,
} from '@sentinel/core'
import type {
  CreateTaskOpts,
  TreeNode,
  OutputFile,
  SkillInfo,
} from '../../shared/ipc-types'

// ─── Task operations ───────────────────────────────────────────────

export async function getTasks(): Promise<TaskInfo[]> {
  return window.api.getTasks()
}

export async function getTask(name: string): Promise<TaskInfo> {
  return window.api.getTask(name)
}

export async function createTask(opts: CreateTaskOpts) {
  return window.api.createTask(opts)
}

export async function deleteTask(name: string) {
  return window.api.deleteTask(name)
}

export async function runTask(name: string) {
  return window.api.runTask(name)
}

export async function getTaskHistory(name: string): Promise<TaskRunRecord[]> {
  return window.api.getTaskHistory(name)
}

export async function getTaskWorkspace(name: string): Promise<{ dir: string; tree: TreeNode[] }> {
  return window.api.getTaskWorkspace(name)
}

export async function getTaskSkills(name: string): Promise<SkillInfo[]> {
  return window.api.getTaskSkills(name)
}

export async function getTaskOutputs(name: string): Promise<OutputFile[]> {
  return window.api.getTaskOutputs(name)
}

export async function readTaskOutput(name: string, filename: string): Promise<string> {
  return window.api.readTaskOutput(name, filename)
}

export async function getTaskScripts(name: string): Promise<string[]> {
  return window.api.getTaskScripts(name)
}

// ─── OpenCode config ───────────────────────────────────────────────

export async function getOpenCodeConfig(name: string) {
  return window.api.getOpenCodeConfig(name)
}

export async function updateOpenCodeConfig(name: string, config: Record<string, unknown>) {
  return window.api.updateOpenCodeConfig(name, config)
}

// ─── Scheduler ─────────────────────────────────────────────────────

export async function startScheduler() {
  return window.api.startScheduler()
}

export async function stopScheduler() {
  return window.api.stopScheduler()
}

export async function getSchedulerStatus() {
  return window.api.getSchedulerStatus()
}

// ─── Event subscriptions ───────────────────────────────────────────

export function onTaskUpdate(callback: (data: { name: string; status: TaskStatus }) => void) {
  return window.api.onTaskUpdate(callback)
}

export function onSchedulerLog(callback: (data: { level: string; msg: string; ts?: number }) => void) {
  return window.api.onSchedulerLog(callback)
}

export function onSchedulerStatus(callback: (data: { running: boolean }) => void) {
  return window.api.onSchedulerStatus(callback)
}
