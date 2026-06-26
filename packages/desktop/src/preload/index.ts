import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-types'
import type { ExposedAPI } from '../shared/ipc-types'

const api: ExposedAPI = {
  // ── Tasks ──
  getTasks: () => ipcRenderer.invoke(IPC.TASKS_LIST),
  getTask: (name) => ipcRenderer.invoke(IPC.TASKS_GET, name),
  createTask: (opts) => ipcRenderer.invoke(IPC.TASKS_CREATE, opts),
  deleteTask: (name) => ipcRenderer.invoke(IPC.TASKS_DELETE, name),
  runTask: (name) => ipcRenderer.invoke(IPC.TASKS_RUN, name),
  getTaskHistory: (name) => ipcRenderer.invoke(IPC.TASKS_HISTORY, name),
  getTaskWorkspace: (name) => ipcRenderer.invoke(IPC.TASKS_WORKSPACE, name),
  getTaskSkills: (name) => ipcRenderer.invoke(IPC.TASKS_SKILLS, name),
  getTaskOutputs: (name) => ipcRenderer.invoke(IPC.TASKS_OUTPUTS, name),
  readTaskOutput: (name, filename) => ipcRenderer.invoke(IPC.TASKS_READ_OUTPUT, name, filename),
  getTaskScripts: (name) => ipcRenderer.invoke(IPC.TASKS_SCRIPTS, name),

  // ── OpenCode config ──
  getOpenCodeConfig: (name) => ipcRenderer.invoke(IPC.TASKS_OPENCODE_GET, name),
  updateOpenCodeConfig: (name, config) => ipcRenderer.invoke(IPC.TASKS_OPENCODE_UPDATE, name, config),

  // ── Scheduler ──
  startScheduler: () => ipcRenderer.invoke(IPC.SCHEDULER_START),
  stopScheduler: () => ipcRenderer.invoke(IPC.SCHEDULER_STOP),
  getSchedulerStatus: () => ipcRenderer.invoke(IPC.SCHEDULER_STATUS),

  // ── Window controls ──
  minimizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),

  // ── Real-time events ──
  onTaskUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; status: string }) => callback(data)
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
