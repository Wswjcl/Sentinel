import { useState, useEffect, useCallback, useRef } from 'react'
import type { TaskInfo, TaskStatus, TaskRunRecord } from '@sentinel/core'
import { ArrowLeft, Play, Pause, Trash2, RefreshCw, FolderOpen, FileText, Clock, Radio, Square } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useModelOptions } from '../../hooks/useModels'
import { describeScheduleText } from '../../lib/schedule'
import PermissionCard from './PermissionCard'
import type { TreeNode, OutputFile, PermissionAskData, LiveEventData, ProviderProfile } from '../../../../shared/ipc-types'

interface TaskDetailProps {
  task: TaskInfo
  onBack: () => void
}

type Tab = 'overview' | 'workspace' | 'outputs' | 'history' | 'live' | 'config'

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
  const { t } = useI18n()

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
    if (!confirm(t('task.deleteConfirm', { name }))) return
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
      setOutputContent(t('detail.errorReadingFile', { error: String(err) }))
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof FolderOpen }[] = [
    { id: 'overview', label: t('detail.overview'), icon: FileText },
    { id: 'workspace', label: t('detail.files'), icon: FolderOpen },
    { id: 'outputs', label: t('detail.outputs'), icon: FileText },
    { id: 'history', label: t('detail.history'), icon: Clock },
    { id: 'live', label: t('detail.live'), icon: Radio },
    { id: 'config', label: t('detail.config'), icon: RefreshCw },
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
              <span className="text-xs font-medium">{t(`status.${task.status}`)}</span>
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
            title={t('task.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRun}
            disabled={running || task.status === 'running' || task.status === 'paused'}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                       bg-[var(--color-green)] text-[var(--color-bg)] hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            <Play className="w-3 h-3" />
            {running ? t('task.running') : t('task.runNow')}
          </button>
          {task.status === 'paused' ? (
            <button
              onClick={async () => {
                await window.api.resumeTask(name)
                refreshTask()
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                         bg-[var(--color-blue)] text-white hover:opacity-90 transition-opacity"
              title={t('task.resume')}
            >
              <Play className="w-3 h-3" />
              {t('task.resume')}
            </button>
          ) : task.status !== 'running' && task.status !== 'archived' ? (
            <button
              onClick={async () => {
                await window.api.pauseTask(name)
                refreshTask()
              }}
              className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-yellow)] transition-colors"
              title={t('task.pause')}
            >
              <Pause className="w-4 h-4" />
            </button>
          ) : null}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded hover:bg-[var(--color-hover)] text-[var(--color-red)] transition-colors"
            title={t('task.deleteTask')}
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
        {tab === 'overview' && <OverviewTab task={task} onRefresh={refreshTask} />}
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
        {tab === 'live' && <LiveTab task={task} />}
        {tab === 'config' && <ConfigTab task={task} onRefresh={refreshTask} />}
      </div>
    </div>
  )
}

// ─── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ task, onRefresh }: { task: TaskInfo; onRefresh: () => void }) {
  const { config, status, lastRun, nextRun, runCount } = task
  const { t, locale } = useI18n()
  const [sessionSaving, setSessionSaving] = useState(false)
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [bindingSaving, setBindingSaving] = useState(false)
  const modelOptions = useModelOptions()
  const [modelDraft, setModelDraft] = useState(config.execution.model ?? '')
  const [modelSaving, setModelSaving] = useState(false)

  useEffect(() => {
    window.api.listProviders().then(setProfiles).catch(() => setProfiles([]))
  }, [])

  useEffect(() => {
    setModelDraft(config.execution.model ?? '')
  }, [config.execution.model])

  const changeSession = async (session: 'fresh' | 'continue' | 'fork') => {
    setSessionSaving(true)
    try {
      await window.api.updateTask(config.name, { execution: { session } })
      onRefresh()
    } finally {
      setSessionSaving(false)
    }
  }

  const changeBinding = async (profileId: string) => {
    setBindingSaving(true)
    try {
      await window.api.bindTaskProvider(config.name, profileId || null)
      onRefresh()
    } finally {
      setBindingSaving(false)
    }
  }

  const changeModel = async (model: string) => {
    const next = model.trim() || undefined
    if ((config.execution.model ?? '') === (next ?? '')) return
    setModelSaving(true)
    try {
      await window.api.updateTask(config.name, { execution: { model: next } })
      onRefresh()
    } finally {
      setModelSaving(false)
    }
  }

  const fields = [
    { label: t('detail.status'), value: t(`status.${status}`) },
    { label: t('detail.schedule'), value: describeScheduleText(config.schedule, t, locale) + (config.schedule.timezone ? ` · ${config.schedule.timezone}` : '') },
    { label: t('detail.timezone'), value: config.schedule.timezone ?? 'UTC' },
    { label: t('detail.model'), value: config.execution.model ?? 'default' },
    { label: t('detail.agent'), value: config.execution.agent ?? 'default' },
    { label: t('detail.timeout'), value: config.execution.timeout ? `${config.execution.timeout / 1000}s` : t('task.none') },
    { label: t('detail.retry'), value: config.execution.retry ? `${config.execution.retry.max}x / ${config.execution.retry.delay}ms` : t('task.none') },
    { label: t('detail.runs'), value: String(runCount) },
    { label: t('detail.lastRun'), value: lastRun ? new Date(lastRun).toLocaleString() : '—' },
    { label: t('detail.nextRun'), value: nextRun ? new Date(nextRun).toLocaleString() : '—' },
    { label: t('detail.directory'), value: task.dir },
  ]

  return (
    <div className="space-y-4">
      {/* Prompt */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('detail.prompt')}</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
          <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{config.execution.prompt}</p>
        </div>
      </div>

      {/* Session mode (editable) */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('create.session')}</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 flex items-center gap-3">
          <select
            value={config.execution.session ?? 'fresh'}
            disabled={sessionSaving}
            onChange={(e) => changeSession(e.target.value as 'fresh' | 'continue' | 'fork')}
            className="flex-1 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                       px-3 py-1.5 text-sm text-[var(--color-text)]
                       focus:outline-none focus:border-[var(--color-blue)] transition-colors"
          >
            <option value="fresh">{t('create.sessionFresh')}</option>
            <option value="continue">{t('create.sessionContinue')}</option>
            <option value="fork">{t('create.sessionFork')}</option>
          </select>
          {sessionSaving && <span className="text-xs text-[var(--color-text-dim)]">{t('detail.saving')}</span>}
        </div>
      </div>

      {/* Provider binding (editable) */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('detail.providerBinding')}</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 flex items-center gap-3">
          <select
            value={config.execution.providerProfile ?? ''}
            disabled={bindingSaving}
            onChange={(e) => void changeBinding(e.target.value)}
            className="flex-1 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                       px-3 py-1.5 text-sm text-[var(--color-text)]
                       focus:outline-none focus:border-[var(--color-blue)] transition-colors"
          >
            <option value="">{t('detail.providerGlobalOption')}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.provider}/{p.model})
              </option>
            ))}
          </select>
          {bindingSaving && <span className="text-xs text-[var(--color-text-dim)]">{t('detail.saving')}</span>}
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mt-1">{t('detail.providerBindingHint')}</p>
      </div>

      {/* Permission card (editable) */}
      <PermissionCard kind="task" name={config.name} />

      {/* Model override (editable) */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('create.model')}</h3>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 flex items-center gap-3">
          <input
            type="text"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={(e) => void changeModel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            placeholder={t('detail.modelPlaceholder')}
            list="detail-model-options"
            className="flex-1 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                       px-3 py-1.5 text-sm font-mono text-[var(--color-text)]
                       focus:outline-none focus:border-[var(--color-blue)] transition-colors"
          />
          <datalist id="detail-model-options">
            {modelOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.free ? `${m.value} · ${t('models.free')}` : m.value}
              </option>
            ))}
          </datalist>
          {modelSaving && <span className="text-xs text-[var(--color-text-dim)]">{t('detail.saving')}</span>}
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mt-1">{t('detail.modelHint')}</p>
      </div>

      {/* Info grid */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('detail.details')}</h3>
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
  const { t } = useI18n()

  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('detail.fileTree')}</h3>
      {tree.length === 0 ? (
        <p className="text-sm text-[var(--color-text-dim)]">{t('detail.emptyWorkspace')}</p>
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
  const { t } = useI18n()

  if (outputs.length === 0) {
    return <p className="text-sm text-[var(--color-text-dim)]">{t('detail.noOutputFiles')}</p>
  }

  return (
    <div className="space-y-4">
      {/* File list */}
      <div>
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">{t('detail.outputFiles')}</h3>
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

// ─── Live Tab (serve runtime) ──────────────────────────────────────

interface LiveLine {
  id: number
  kind: 'text' | 'reasoning' | 'tool' | 'status'
  text: string
}

function LiveTab({ task }: { task: TaskInfo }) {
  const { t } = useI18n()
  const [lines, setLines] = useState<LiveLine[]>([])
  const streamRef = useRef<HTMLDivElement>(null)
  const name = task.config.name

  useEffect(() => {
    setLines([])
    let seq = 0
    const push = (kind: LiveLine['kind'], text: string) => {
      setLines((prev) => [...prev, { id: seq++, kind, text }].slice(-500))
    }
    const unsubLive = window.api.onTaskLiveEvent(({ name: n, event }) => {
      if (n !== name) return
      if (event.kind === 'text') push('text', event.text)
      else if (event.kind === 'reasoning') push('reasoning', event.text)
      else if (event.kind === 'tool-start') push('tool', `▶ ${event.tool}${event.title ? `: ${event.title}` : ''}`)
      else if (event.kind === 'tool-finish') push('tool', `${event.status === 'completed' ? '✓' : '✗'} ${event.tool} [${event.status}]`)
      else if (event.kind === 'status') push('status', event.status)
    })
    const unsubPerm = window.api.onTaskPermission(({ name: n, request }) => {
      if (n !== name) return
      // Permission asks surface in the global overlay (MainLayout); here we
      // only mark the stream so the ask is visible in context.
      push('status', `${t('detail.permissionAsk', { tool: request.permission })}`)
    })
    return () => {
      unsubLive()
      unsubPerm()
    }
  }, [name])

  // Keep the stream pinned to the bottom as new output arrives
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
          {t('detail.live')}
        </h3>
        {task.status === 'running' && (
          <button
            onClick={() => window.api.abortTask(name)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                       bg-[var(--color-red)] text-white hover:opacity-90 transition-opacity"
          >
            <Square className="w-3 h-3" />
            {t('detail.stop')}
          </button>
        )}
      </div>

      {/* Live stream */}
      <div
        ref={streamRef}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 max-h-[50vh] overflow-y-auto"
      >
        {lines.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">{t('detail.liveEmpty')}</p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={
                line.kind === 'tool'
                  ? 'text-xs text-[var(--color-blue)] font-mono'
                  : line.kind === 'reasoning'
                    ? 'text-xs text-[var(--color-text-dim)] italic'
                    : line.kind === 'status'
                      ? 'text-xs text-[var(--color-yellow)]'
                      : 'text-sm text-[var(--color-text)] whitespace-pre-wrap'
              }
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── History Tab ───────────────────────────────────────────────────

function HistoryTab({ history }: { history: TaskRunRecord[] }) {
  const { t } = useI18n()

  if (history.length === 0) {
    return <p className="text-sm text-[var(--color-text-dim)]">{t('detail.noHistory')}</p>
  }

  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
        {t('detail.runHistory', { count: history.length })}
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
                  {t(`status.${record.status}`)}
                </span>
                {record.exitCode !== undefined && (
                  <span className="text-xs text-[var(--color-text-dim)]">
                    {t('detail.exit')} {record.exitCode}
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
                {t('detail.duration')} {Math.round(new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime()) / 1000}s
              </p>
            )}
            {(record.steps !== undefined || record.tokens) && (
              <p className="text-xs text-[var(--color-text-dim)] mt-1">
                {t('detail.usage')}:{' '}
                {record.steps !== undefined && <>{record.steps} steps</>}
                {record.tokens && <>{record.steps !== undefined && ' · '}{record.tokens.total.toLocaleString()} tokens ({record.tokens.output.toLocaleString()} out)</>}
                {record.cost ? <> · ${record.cost.toFixed(4)}</> : null}
              </p>
            )}
            {(record.provider || record.modelUsed) && (
              <p className="text-xs text-[var(--color-text-dim)] mt-1">
                {t('detail.servedBy')}{' '}
                {record.provider && <span className="text-[var(--color-text-muted)]">{record.provider}</span>}
                {record.provider && record.modelUsed && ' / '}
                {record.modelUsed && <span className="font-mono">{record.modelUsed}</span>}
                {record.endpoint && <> · <span className="font-mono">{record.endpoint}</span></>}
                {record.providerSource === 'global' && <> · {t('detail.providerGlobal')}</>}
              </p>
            )}
            {record.toolCalls && record.toolCalls.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
                  {t('detail.toolCalls', { count: record.toolCalls.length })}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {record.toolCalls.map((call, i) => (
                    <li key={i} className="text-xs text-[var(--color-text-dim)] font-mono flex items-center gap-1.5">
                      <span className={
                        call.status === 'completed' ? 'text-[var(--color-green)]' :
                        call.status === 'error' ? 'text-[var(--color-red)]' : ''
                      }>●</span>
                      {call.tool}
                      {call.title && <span className="truncate max-w-[300px]">{call.title}</span>}
                      {call.status !== 'completed' && <span>({call.status})</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {record.permissionAsks && record.permissionAsks.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
                  {t('detail.permAsks', { count: record.permissionAsks.length })}
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {record.permissionAsks.map((ask, i) => (
                    <li key={i} className="text-xs text-[var(--color-text-dim)] font-mono flex items-center gap-1.5">
                      <span className={
                        ask.response === 'timeout' || ask.response === 'reject'
                          ? 'text-[var(--color-red)]'
                          : 'text-[var(--color-green)]'
                      }>●</span>
                      {ask.permission}
                      {ask.patterns.length > 0 && <span className="truncate max-w-[300px]">{ask.patterns[0]}</span>}
                      <span>→ {t(`detail.permResp.${ask.response}`)}</span>
                    </li>
                  ))}
                </ul>
              </details>
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
  const [taskConfigText, setTaskConfigText] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    window.api.getOpenCodeConfig(task.config.name).then((c) => {
      setConfig(JSON.stringify(c, null, 2))
    }).catch(console.error)
  }, [task.config.name])

  useEffect(() => {
    setTaskConfigText(JSON.stringify(task.config, null, 2))
  }, [task.config])

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
            {t('detail.opencodeConfig')}
          </h3>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 rounded text-xs font-medium bg-[var(--color-blue)] text-[var(--color-bg)]
                       hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? t('detail.saving') : t('detail.save')}
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

      {/* Task Config — editable */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            {t('detail.taskConfig')}
          </h3>
          <button
            onClick={async () => {
              try {
                const parsed = JSON.parse(taskConfigText)
                await window.api.updateTask(task.config.name, {
                  description: parsed.description,
                  schedule: parsed.schedule,
                  execution: {
                    prompt: parsed.execution?.prompt,
                    model: parsed.execution?.model,
                    agent: parsed.execution?.agent,
                    timeout: parsed.execution?.timeout,
                    retry: parsed.execution?.retry,
                    skills: parsed.execution?.skills,
                  },
                })
                onRefresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
            className="px-3 py-1 rounded text-xs font-medium bg-[var(--color-green)] text-[var(--color-bg)]
                       hover:opacity-90 transition-opacity"
          >
            {t('detail.save')}
          </button>
        </div>
        <textarea
          value={taskConfigText}
          onChange={(e) => setTaskConfigText(e.target.value)}
          spellCheck={false}
          className="w-full h-60 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3
                     text-xs text-[var(--color-text)] font-mono resize-y
                     focus:outline-none focus:border-[var(--color-blue)] transition-colors"
        />
      </div>
    </div>
  )
}
