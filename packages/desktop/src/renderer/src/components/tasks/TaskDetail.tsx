import { useState, useEffect, useCallback } from 'react'
import type { TaskInfo, TaskStatus, TaskRunRecord } from '@wwc/core'
import { ArrowLeft, Play, Trash2, RefreshCw, FolderOpen, FileText, Clock } from 'lucide-react'
import type { TreeNode, OutputFile } from '../../../shared/ipc-types'

interface TaskDetailProps {
  task: TaskInfo
  onBack: () => void
}

type Tab = 'overview' | 'workspace' | 'outputs' | 'history' | 'config'

const statusLabel: Record<TaskStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  paused: 'Paused',
  archived: 'Archived',
}

const statusColor: Record<TaskStatus, string> = {
  pending: 'text-[var(--color-text-muted)]',
  scheduled: 'text-[var(--color-blue)]',
  running: 'text-[var(--color-green)]',
  success: 'text-[var(--color-green)]',
  failed: 'text-[var(--color-red)]',
  paused: 'text-[var(--color-yellow)]',
  archived: 'text-[var(--color-text-dim)]',
}

const statusDot: Record<TaskStatus, string> = {
  pending: 'bg-[var(--color-text-dim)]',
  scheduled: 'bg-[var(--color-blue)]',
  running: 'bg-[var(--color-green)]',
  success: 'bg-[var(--color-green)]',
  failed: 'bg-[var(--color-red)]',
  paused: 'bg-[var(--color-yellow)]',
  archived: 'bg-[var(--color-text-dim)]',
}

export default function TaskDetail({ task: initialTask, onBack }: TaskDetailProps) {
  const [task, setTask] = useState<TaskInfo>(initialTask)
  const [tab, setTab] = useState<Tab>('overview')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [outputs, setOutputs] = useState<OutputFile[]>([])
  const [outputContent, setOutputContent] = useState<string | null>(null)
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const name = task.config.name

  // Refresh task info on focus / event
  const refreshTask = useCallback(async () => {
    try {
      const info = await window.api.getTask(name)
      setTask(info)
    } catch (err) {
      console.error('Failed to refresh task:', err)
    }
  }, [name])

  useEffect(() => {
    const unsub = window.api.onTaskUpdate((data) => {
      if (data.name === name) refreshTask()
    })
    return unsub
  }, [name, refreshTask])

  // Load tab-specific data
  useEffect(() => {
    if (tab === 'workspace') {
      window.api.getTaskWorkspace(name).then((ws) => setTree(ws.tree)).catch(console.error)
    } else if (tab === 'outputs') {
      window.api.getTaskOutputs(name).then(setOutputs).catch(console.error)
      setSelectedOutput(null)
      setOutputContent(null)
    }
  }, [tab, name])

  const handleRun = async () => {
    setRunning(true)
    try {
      await window.api.runTask(name)
      await refreshTask()
    } catch (err) {
      console.error('Run failed:', err)
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete task "${name}" and all its data?`)) return
    setDeleting(true)
    try {
      await window.api.deleteTask(name)
      onBack()
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
    }
  }

  const handleReadOutput = async (filename: string) => {
    setSelectedOutput(filename)
    try {
      const content = await window.api.readTaskOutput(name, filename)
      setOutputContent(content)
    } catch (err) {
      setOutputContent(`Error reading file: ${err}`)
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof FolderOpen }[] = [
    { id: 'overview', label: 'Overview', icon: FileText },
    { id: 'workspace', label: 'Files', icon: FolderOpen },
    { id: 'outputs', label: 'Outputs', icon: FileText },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'config', label: 'Config', icon: RefreshCw },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-[var(--color-text-bright)] truncate">{name}</h1>
            <div className={`flex items-center gap-1 ${statusColor[task.status]}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${statusDot[task.status]} ${task.status === 'running' ? 'animate-pulse-dot' : ''}`} />
              <span className="text-xs font-medium">{statusLabel[task.status]}</span>
            </div>
          </div>
          {task.config.description && (
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
              {task.config.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={refreshTask}
            className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRun}
            disabled={running || task.status === 'running'}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                       bg-[var(--color-green)] text-[var(--color-bg)] hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            <Play className="w-3 h-3" />
            {running ? 'Running...' : 'Run Now'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-red)] transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-6 flex gap-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-[var(--color-blue)] text-[var(--color-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6 selectable">
        {tab === 'overview' && <OverviewTab task={task} />}
        {tab === 'workspace' && <WorkspaceTab tree={tree} />}
        {tab === 'outputs' && (
          <OutputsTab
            outputs={outputs}
            selectedOutput={selectedOutput}
            outputContent={outputContent}
            onSelect={handleReadOutput}
          />
        )}
        {tab === 'history' && <HistoryTab history={task.history} />}
        {tab === 'config' && <ConfigTab task={task} onRefresh={refreshTask} />}
      </div>
    </div>
  )
}

// ─── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ task }: { task: TaskInfo }) {
  const { config, status, lastRun, nextRun, runCount } = task

  const fields = [
    { label: 'Status', value: statusLabel[status] },
    { label: 'Schedule', value: `${config.schedule.type}: ${config.schedule.expr}` },
    { label: 'Timezone', value: config.schedule.timezone ?? 'UTC' },
    { label: 'Model', value: config.execution.model ?? 'default' },
    { label: 'Agent', value: config.execution.agent ?? 'default' },
    { label: 'Timeout', value: config.execution.timeout ? `${config.execution.timeout / 1000}s` : 'none' },
    { label: 'Retry', value: config.execution.retry ? `${config.execution.retry.max}x / ${config.execution.retry.delay}ms` : 'none' },
    { label: 'Runs', value: String(runCount) },
    { label: 'Last Run', value: lastRun ? new Date(lastRun).toLocaleString() : '—' },
    { label: 'Next Run', value: nextRun ? new Date(nextRun).toLocaleString() : '—' },
    { label: 'Directory', value: task.dir },
  ]

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Prompt</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{config.execution.prompt}</p>
        </div>
      </div>

      {/* Info grid */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Details</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex items-center px-3 py-2">
              <span className="text-xs text-[var(--color-text-muted)] w-24 shrink-0">{label}</span>
              <span className="text-sm text-[var(--color-text)] break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Workspace Tab ─────────────────────────────────────────────────

function WorkspaceTab({ tree }: { tree: TreeNode[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">File Tree</h3>
      {tree.length === 0 ? (
        <p className="text-sm text-[var(--color-text-dim)]">Empty workspace</p>
      ) : (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
          <TreeNodes nodes={tree} depth={0} />
        </div>
      )}
    </div>
  )
}

function TreeNodes({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          <div
            className="flex items-center gap-1.5 py-0.5 text-sm"
            style={{ paddingLeft: depth * 16 }}
          >
            <span className="text-[var(--color-text-dim)]">
              {node.type === 'dir' ? '📁' : '📄'}
            </span>
            <span className={`${node.type === 'dir' ? 'text-[var(--color-text-bright)]' : 'text-[var(--color-text)]'}`}>
              {node.name}
            </span>
          </div>
          {node.children && <TreeNodes nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  )
}

// ─── Outputs Tab ───────────────────────────────────────────────────

function OutputsTab({
  outputs,
  selectedOutput,
  outputContent,
  onSelect,
}: {
  outputs: OutputFile[]
  selectedOutput: string | null
  outputContent: string | null
  onSelect: (filename: string) => void
}) {
  if (outputs.length === 0) {
    return <p className="text-sm text-[var(--color-text-dim)]">No output files yet</p>
  }

  return (
    <div className="space-y-4">
      {/* File list */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">Output Files</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {outputs.map((file) => (
            <button
              key={file.name}
              onClick={() => onSelect(file.name)}
              className={`w-full text-left flex items-center justify-between px-3 py-2 transition-colors ${
                selectedOutput === file.name
                  ? 'bg-[var(--color-hover)]'
                  : 'hover:bg-[var(--color-hover)]'
              }`}
            >
              <span className="text-sm text-[var(--color-text)]">{file.name}</span>
              <span className="text-xs text-[var(--color-text-dim)]">
                {formatSize(file.size)} · {new Date(file.mtime).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content preview */}
      {selectedOutput && outputContent !== null && (
        <div>
          <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
            {selectedOutput}
          </h3>
          <pre className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 text-xs text-[var(--color-text)] overflow-x-auto max-h-96 overflow-y-auto font-mono">
            {outputContent}
          </pre>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── History Tab ───────────────────────────────────────────────────

function HistoryTab({ history }: { history: TaskRunRecord[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-[var(--color-text-dim)]">No run history yet</p>
  }

  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
        Run History ({history.length})
      </h3>
      <div className="space-y-2">
        {[...history].reverse().map((record) => (
          <div
            key={record.id}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${
                  record.status === 'success' ? 'bg-[var(--color-green)]' :
                  record.status === 'failed' ? 'bg-[var(--color-red)]' :
                  'bg-[var(--color-blue)]'
                }`} />
                <span className="text-sm font-medium text-[var(--color-text)]">
                  {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                </span>
                {record.exitCode !== undefined && (
                  <span className="text-xs text-[var(--color-text-dim)]">
                    exit {record.exitCode}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--color-text-dim)]">
                {new Date(record.startedAt).toLocaleString()}
              </span>
            </div>
            {record.error && (
              <p className="text-xs text-[var(--color-red)] mt-1 whitespace-pre-wrap">{record.error}</p>
            )}
            {record.finishedAt && (
              <p className="text-xs text-[var(--color-text-dim)] mt-1">
                Duration: {Math.round(new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()) / 1000}s
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Config Tab ────────────────────────────────────────────────────

function ConfigTab({ task, onRefresh }: { task: TaskInfo; onRefresh: () => void }) {
  const [config, setConfig] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    window.api.getOpenCodeConfig(task.config.name).then((c) => {
      setConfig(JSON.stringify(c, null, 2))
    }).catch(console.error)
  }, [task.config.name])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const parsed = JSON.parse(config)
      await window.api.updateOpenCodeConfig(task.config.name, parsed)
      setDirty(false)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* OpenCode config */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            OpenCode Config (.opencode/opencode.json)
          </h3>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 rounded text-xs font-medium bg-[var(--color-blue)] text-[var(--color-bg)]
                       hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <textarea
          value={config}
          onChange={(e) => { setConfig(e.target.value); setDirty(true) }}
          spellCheck={false}
          className="w-full h-80 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3
                     text-xs text-[var(--color-text)] font-mono resize-y
                     focus:outline-none focus:border-[var(--color-blue)] transition-colors"
        />
        {error && (
          <p className="text-xs text-[var(--color-red)] mt-1">{error}</p>
        )}
      </div>

      {/* Task YAML (read-only display) */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
          Task Config (task.yaml)
        </h3>
        <pre className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 text-xs text-[var(--color-text-dim)] font-mono overflow-x-auto">
          {JSON.stringify(task.config, null, 2)}
        </pre>
      </div>
    </div>
  )
}
