import { contextBridge, ipcRenderer } from 'electron'
import type { TaskStatus, FlowConfig } from '@sentinel/core'
import { IPC } from '../shared/ipc-types'
import type { ExposedAPI, LoopEventData, FlowEventData, RuntimeMode, LiveEventData, PermissionAskData } from '../shared/ipc-types'

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
  runFlow: (name, inputs, resumeRunId) => ipcRenderer.invoke(IPC.FLOWS_RUN, name, inputs, resumeRunId),
  cloneFlow: (name, newName) => ipcRenderer.invoke(IPC.FLOWS_CLONE, name, newName),
  validateFlowConfig: (config) => ipcRenderer.invoke(IPC.FLOWS_VALIDATE, config),
  exportFlow: (name) => ipcRenderer.invoke(IPC.FLOWS_EXPORT, name),
  importFlow: () => ipcRenderer.invoke(IPC.FLOWS_IMPORT),
  resolveManualGate: (name, runId, node, decision) => ipcRenderer.invoke(IPC.FLOW_MANUAL_RESOLVE, name, runId, node, decision),

  // ── Skills library ──
  listAllSkills: () => ipcRenderer.invoke(IPC.SKILLS_LIST_ALL),
  saveSkill: (ref, name, content) => ipcRenderer.invoke(IPC.SKILLS_SAVE, ref, name, content),
  deleteSkill: (ref, name) => ipcRenderer.invoke(IPC.SKILLS_DELETE, ref, name),
  copySkill: (from, to) => ipcRenderer.invoke(IPC.SKILLS_COPY, from, to),
  exportSkill: (ref, name) => ipcRenderer.invoke(IPC.SKILLS_EXPORT, ref, name),
  importSkill: (to) => ipcRenderer.invoke(IPC.SKILLS_IMPORT, to),

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
  getAppDataDir: () => ipcRenderer.invoke(IPC.APP_DATA),
  restartApp: () => ipcRenderer.invoke(IPC.APP_RESTART),

  // ── Tasks directory relocation ──
  getTasksDirInfo: () => ipcRenderer.invoke(IPC.TASKS_DIR_INFO),
  chooseTasksDir: () => ipcRenderer.invoke(IPC.TASKS_DIR_CHOOSE),
  setTasksDir: (dir, migrate) => ipcRenderer.invoke(IPC.TASKS_DIR_SET, { dir, migrate }),

  // ── Provider profiles ──
  listProviders: () => ipcRenderer.invoke(IPC.PROVIDERS_LIST),
  saveProvider: (profile) => ipcRenderer.invoke(IPC.PROVIDERS_SAVE, profile),
  deleteProvider: (id) => ipcRenderer.invoke(IPC.PROVIDERS_DELETE, id),
  bindTaskProvider: (name, profileId) => ipcRenderer.invoke(IPC.TASK_BIND_PROVIDER, name, profileId),
  getTaskPermission: (name) => ipcRenderer.invoke(IPC.TASK_PERMISSION_GET, name),
  setTaskPermission: (name, profile) => ipcRenderer.invoke(IPC.TASK_PERMISSION_SET, name, profile),
  getFlowPermission: (name) => ipcRenderer.invoke(IPC.FLOW_PERMISSION_GET, name),
  getUsage: (days) => ipcRenderer.invoke(IPC.USAGE_GET, days),
  setFlowPermission: (name, profile) => ipcRenderer.invoke(IPC.FLOW_PERMISSION_SET, name, profile),
  fetchProviderModels: (baseUrl, apiKey) => ipcRenderer.invoke(IPC.PROVIDERS_FETCH_MODELS, { baseUrl, apiKey }),
  getModelList: () => ipcRenderer.invoke(IPC.MODELS_LIST),

  // ── Serve runtime ──
  getRuntimeMode: () => ipcRenderer.invoke(IPC.RUNTIME_MODE_GET),
  setRuntimeMode: (mode) => ipcRenderer.invoke(IPC.RUNTIME_MODE_SET, mode),
  respondTaskPermission: (permissionId, response) => ipcRenderer.invoke(IPC.TASK_PERMISSION_RESPOND, permissionId, response),
  abortTask: (name) => ipcRenderer.invoke(IPC.TASK_ABORT, name),

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

  onTaskLiveEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; event: LiveEventData }) => callback(data)
    ipcRenderer.on(IPC.EVENT_TASK_LIVE, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_TASK_LIVE, handler)
  },

  onTaskPermission: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; request: PermissionAskData }) => callback(data)
    ipcRenderer.on(IPC.EVENT_TASK_PERMISSION, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_TASK_PERMISSION, handler)
  },

  onTaskPermissionResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; id: string; response: 'once' | 'always' | 'reject' | 'timeout' }) => callback(data)
    ipcRenderer.on(IPC.EVENT_TASK_PERMISSION_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC.EVENT_TASK_PERMISSION_RESULT, handler)
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
