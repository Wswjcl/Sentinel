import { contextBridge, ipcRenderer } from 'electron'
import type { TaskStatus, FlowConfig } from '@sentinel/core'
import { IPC } from '../shared/ipc-types'
import type { ExposedAPI, LoopEventData, FlowEventData } from '../shared/ipc-types'

const api: ExposedAPI = {
  // ── Tasks ──
  getTasks: () => ipcRenderer.invoke(IPC.TASKS_LIST),
  getTask: (name) => ipcRenderer.invoke(IPC.TASKS_GET, name),
  createTask: (opts) => ipcRenderer.invoke(IPC.TASKS_CREATE, opts),
  deleteTask: (name) => ipcRenderer.invoke(IPC.TASKS_DELETE, name),
  runTask: (name) => ipcRenderer.invoke(IPC.TASKS_RUN, name),
  pauseTask: (name) => ipcRenderer.invoke(IPC.TASKS_PAUSE, name),
  resumeTask: (name) => ipcRenderer.invoke(IPC.TASKS_RESUME, name),
  updateTask: (name, opts) => ipcRenderer.invoke(IPC.TASKS_UPDATE, name, opts),
  getTaskHistory: (name) => ipcRenderer.invoke(IPC.TASKS_HISTORY, name),
  getTaskWorkspace: (name) => ipcRenderer.invoke(IPC.TASKS_WORKSPACE, name),
  getTaskSkills: (name) => ipcRenderer.invoke(IPC.TASKS_SKILLS, name),
  getTaskOutputs: (name) => ipcRenderer.invoke(IPC.TASKS_OUTPUTS, name),
  readTaskOutput: (name, filename) => ipcRenderer.invoke(IPC.TASKS_READ_OUTPUT, name, filename),
  getTaskScripts: (name) => ipcRenderer.invoke(IPC.TASKS_SCRIPTS, name),

  // ── OpenCode config ──
  getOpenCodeConfig: (name) => ipcRenderer.invoke(IPC.TASKS_OPENCODE_GET, name),
  updateOpenCodeConfig: (name, config) => ipcRenderer.invoke(IPC.TASKS_OPENCODE_UPDATE, name, config),

  // ── Flows ──
  getFlows: () => ipcRenderer.invoke(IPC.FLOWS_LIST),
  getFlow: (name) => ipcRenderer.invoke(IPC.FLOWS_GET, name),
  saveFlow: (name, config: FlowConfig) => ipcRenderer.invoke(IPC.FLOWS_SAVE, name, config),
  deleteFlow: (name) => ipcRenderer.invoke(IPC.FLOWS_DELETE, name),
  runFlow: (name, inputs) => ipcRenderer.invoke(IPC.FLOWS_RUN, name, inputs),
  validateFlowConfig: (config) => ipcRenderer.invoke(IPC.FLOWS_VALIDATE, config),

  // ── Scheduler ──
  startScheduler: () => ipcRenderer.invoke(IPC.SCHEDULER_START),
  stopScheduler: () => ipcRenderer.invoke(IPC.SCHEDULER_STOP),
  getSchedulerStatus: () => ipcRenderer.invoke(IPC.SCHEDULER_STATUS),

  // ── Window controls ──
  minimizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),

  // ── App ──
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_VERSION),

  // ── Real-time events ──
  onTaskUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; status: TaskStatus }) => callback(data)
    ipcRenderer.on(IPC.EVENT_TASK_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_TASK_UPDATE, handler)
  },

  onSchedulerLog: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { level: string; msg: string; ts?: number }) => callback(data)
    ipcRenderer.on(IPC.EVENT_SCHEDULER_LOG, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_SCHEDULER_LOG, handler)
  },

  onSchedulerStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { running: boolean }) => callback(data)
    ipcRenderer.on(IPC.EVENT_SCHEDULER_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_SCHEDULER_STATUS, handler)
  },

  onLoopUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: LoopEventData) => callback(data)
    ipcRenderer.on(IPC.EVENT_LOOP_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_LOOP_UPDATE, handler)
  },

  onFlowUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: FlowEventData) => callback(data)
    ipcRenderer.on(IPC.EVENT_FLOW_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_FLOW_UPDATE, handler)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as any).api = api
}
