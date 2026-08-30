import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Play, Plus, Trash2, Save, RotateCcw, Check, X, Download, ShieldAlert, Copy } from 'lucide-react'
import type { FlowConfig, FlowNode, FlowNodeStatus, FlowNodeRun, FlowRun } from '@sentinel/core'
import { edgeTarget, edgeCondition } from '../../lib/flow-edges'
import { copyToClipboard } from '../../lib/clipboard'
import type { FlowInfo } from '../../../../shared/ipc-types'
import { useI18n } from '../../hooks/useI18n'
import FlowCanvas from './FlowCanvas'

interface FlowDetailProps {
  name: string
  onBack: () => void
}

const inputCls = `w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`
const labelCls = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1'

export default function FlowDetail({ name, onBack }: FlowDetailProps) {
  const { t } = useI18n()
  const [info, setInfo] = useState<FlowInfo | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [liveStatuses, setLiveStatuses] = useState<Record<string, FlowNodeStatus>>({})
  const [running, setRunning] = useState(false)
  const [inputsText, setInputsText] = useState('')
  const [newNodeName, setNewNodeName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [gates, setGates] = useState<{ runId: string; node: string; message?: string }[]>([])
  const [gateNotes, setGateNotes] = useState<Record<string, string>>({})
  const [inspect, setInspect] = useState<{ runId: string; node: string } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setInfo(await window.api.getFlow(name))
    } catch (err) {
      setError(String(err))
    }
  }, [name])

  // Debounced refresh while a run is live: every node settle persists the
  // run, so re-reading it surfaces outputs/errors mid-run (inspection).
  const refreshTimer = useRef<number | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, 200)
  }, [refresh])

  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  /** Copy an inspector field and flash a confirmation on its button. */
  const copyField = useCallback((key: string, text: string) => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return
      setCopiedKey(key)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 1500)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Seed live state from persisted runs: opening the detail view after a
  // run started (e.g. via the gate notification) must still show the
  // running state and any gate that is already waiting.
  useEffect(() => {
    if (!info) return
    const live = info.runs.filter((r) => r.status === 'running')
    if (live.length > 0) setRunning(true)
    for (const r of live) {
      for (const nr of Object.values(r.nodes)) {
        if (nr.status === 'waiting') {
          setGates((prev) =>
            prev.some((g) => g.runId === r.id && g.node === nr.node)
              ? prev
              : [...prev, { runId: r.id, node: nr.node }],
          )
        }
      }
    }
  }, [info])

  useEffect(() => {
    const unsub = window.api.onFlowUpdate((data) => {
      if (data.name !== name) return
      if (data.event === 'started') {
        setLiveStatuses({})
        setRunning(true)
        setGates([])
        // Show the new run (all nodes pending) in the history immediately
        refresh()
      } else if (data.event === 'node-status-changed') {
        setLiveStatuses((prev) => ({ ...prev, [data.node]: data.status }))
        // Any transition out of 'waiting' settles the gate card
        if (data.status !== 'waiting') {
          setGates((prev) => prev.filter((g) => !(g.runId === data.runId && g.node === data.node)))
        }
        // Pick up settled node outputs/errors for the inspector
        scheduleRefresh()
      } else if (data.event === 'manual-gate') {
        setGates((prev) =>
          prev.some((g) => g.runId === data.runId && g.node === data.node)
            ? prev
            : [...prev, { runId: data.runId, node: data.node, message: data.message }],
        )
      } else if (data.event === 'completed') {
        setRunning(false)
        setGates([])
        refresh()
      }
    })
    return unsub
  }, [name, refresh, scheduleRefresh])

  if (!info) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-muted)]">
        {error ?? t('flows.loading')}
      </div>
    )
  }

  const config = info.config
  const nodeNames = Object.keys(config.nodes ?? {})
  const node: FlowNode | null = selectedNode ? config.nodes[selectedNode] ?? null : null

  const persist = async (next: FlowConfig): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await window.api.saveFlow(name, next)
      setInfo((prev) => (prev ? { ...prev, config: next } : prev))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const updateNode = (nodeName: string, patch: Partial<FlowNode>) => {
    const current = config.nodes[nodeName]
    if (!current) return
    const next: FlowConfig = {
      ...config,
      nodes: { ...config.nodes, [nodeName]: { ...current, ...patch } as FlowNode },
    }
    void persist(next)
  }

  const deleteNode = async (nodeName: string) => {
    if (Object.keys(config.nodes).length <= 1) {
      setError(t('flows.cannotDeleteLastNode'))
      return
    }
    const nodes = { ...config.nodes }
    delete nodes[nodeName]
    const next: FlowConfig = { ...config, nodes }
    // Drop dangling dependency references in remaining nodes
    for (const n of Object.keys(next.nodes)) {
      const needs = next.nodes[n].needs?.filter((d) => edgeTarget(d) !== nodeName)
      if (needs && needs.length !== (next.nodes[n].needs ?? []).length) {
        next.nodes[n] = { ...next.nodes[n], needs: needs.length > 0 ? needs : undefined }
      }
    }
    if (selectedNode === nodeName) setSelectedNode(null)
    await persist(next)
  }

  const addNode = async () => {
    const nodeName = newNodeName.trim()
    if (!nodeName) return
    if (!/^[a-zA-Z0-9_-]+$/.test(nodeName) || nodeName in config.nodes) {
      setError(t('flows.nameInvalid'))
      return
    }
    const next: FlowConfig = {
      ...config,
      nodes: { ...config.nodes, [nodeName]: { type: 'script', run: 'echo new node' } },
    }
    setNewNodeName('')
    await persist(next)
    setSelectedNode(nodeName)
  }

  const runFlow = async (resumeRunId?: string) => {
    setError(null)
    const inputs: Record<string, string> = {}
    if (!resumeRunId) {
      for (const part of inputsText.split(',')) {
        const kv = part.trim()
        if (!kv) continue
        const eq = kv.indexOf('=')
        if (eq <= 0) {
          setError(t('flows.inputsInvalid'))
          return
        }
        inputs[kv.slice(0, eq)] = kv.slice(eq + 1)
      }
    }
    try {
      await window.api.runFlow(name, inputs, resumeRunId)
      setRunning(true)
      setLiveStatuses({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const lastRuns = info.runs.slice(-5).reverse()

  const respondGate = async (runId: string, node: string, approved: boolean) => {
    const note = gateNotes[`${runId}::${node}`]?.trim() || undefined
    setGates((prev) => prev.filter((g) => !(g.runId === runId && g.node === node)))
    try {
      const res = await window.api.resolveManualGate(name, runId, node, { approved, note })
      if (!res.ok) setError(t('flows.gateGone'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const exportCurrent = async () => {
    setError(null)
    try {
      await window.api.exportFlow(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const statusBadge = (s: string) => {
    const cls =
      s === 'success' ? 'text-[var(--color-green)]' :
      s === 'failed' ? 'text-[var(--color-red)]' :
      s === 'partial' ? 'text-[var(--color-yellow, #eab308)]' :
      'text-[var(--color-blue)]'
    return <span className={`font-medium ${cls}`}>{t(`flows.flowStatus.${s}`)}</span>
  }

  const nodeStatusCls = (s: FlowNodeStatus): string =>
    s === 'success' ? 'text-[var(--color-green)]' :
    s === 'failed' ? 'text-[var(--color-red)]' :
    s === 'running' ? 'text-[var(--color-blue)]' :
    s === 'waiting' ? 'text-[var(--color-yellow, #eab308)]' :
    'text-[var(--color-text-dim)]'

  const nodeStatusIcon = (s: FlowNodeStatus): string =>
    s === 'success' ? '✓' : s === 'failed' ? '✗' : s === 'running' ? '◉' :
    s === 'waiting' ? '⏸' : s === 'pending' ? '○' : '⏭'

  const fmtDuration = (start?: string, end?: string): string | null => {
    if (!start || !end) return null
    const ms = Date.parse(end) - Date.parse(start)
    if (Number.isNaN(ms) || ms < 0) return null
    if (ms < 1000) return `${ms}ms`
    const s = Math.round(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
  }

  /** Node run inspector: full output / failure reason / timing for one
   *  node of one run - the "why did it fail / what did it produce" view. */
  const nodeInspector = (run: FlowRun, nr: FlowNodeRun) => {
    const dur = fmtDuration(nr.startedAt, nr.finishedAt)
    const waitDur = fmtDuration(nr.waitingSince, nr.finishedAt ?? undefined)
    return (
      <div className="mt-2 pt-2 border-t border-[var(--color-border)] space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={`font-medium ${nodeStatusCls(nr.status)}`}>
            {nodeStatusIcon(nr.status)} {nr.node}
          </span>
          <span className="text-[var(--color-text-dim)] font-mono">{nr.type}</span>
          {nr.aiTakeover && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--color-blue)]/15 text-[var(--color-blue)]">
              {t('flows.aiTakeoverBadge')}
            </span>
          )}
          {nr.startedAt && (
            <span className="text-[var(--color-text-dim)]">
              {t('flows.startedAt')} {new Date(nr.startedAt).toLocaleString()}
            </span>
          )}
          {dur && <span className="text-[var(--color-text-dim)]">{t('flows.duration')} {dur}</span>}
          {nr.status === 'waiting' && waitDur && (
            <span className="text-[var(--color-yellow, #eab308)]">{t('flows.waitingFor')} {waitDur}</span>
          )}
          {nr.taskRecordId && (
            <span className="text-[var(--color-text-dim)] font-mono" title={t('flows.taskRecordId')}>
              ⧉ {nr.taskRecordId.slice(0, 8)}
            </span>
          )}
          {(nr.provider || nr.modelUsed) && (
            <span className="text-[var(--color-text-dim)]" title={nr.endpoint ?? ''}>
              {t('flows.servedBy')}{' '}
              <span className="text-[var(--color-text-muted)]">
                {[nr.provider, nr.modelUsed].filter(Boolean).join('/')}
              </span>
              {nr.endpoint && <> · <span className="font-mono">{nr.endpoint}</span></>}
            </span>
          )}
        </div>
        {nr.skipReason && (
          <div className="text-xs text-[var(--color-text-dim)]">
            {t('flows.skipReasonLabel')}: {t(`flows.skipReason.${nr.skipReason}`)}
          </div>
        )}
        {nr.error && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-medium text-[var(--color-red)]">{t('flows.errorLabel')}</div>
              <button
                type="button"
                onClick={() => copyField(`${run.id}::${nr.node}::error`, nr.error!)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors
                           text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
                title={t('flows.copy')}
              >
                {copiedKey === `${run.id}::${nr.node}::error`
                  ? <><Check className="w-3 h-3" />{t('flows.copied')}</>
                  : <><Copy className="w-3 h-3" />{t('flows.copy')}</>}
              </button>
            </div>
            <pre className="text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg p-2
                           whitespace-pre-wrap break-all max-h-40 overflow-auto font-mono">{nr.error}</pre>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-medium text-[var(--color-text-muted)]">{t('flows.outputLabel')}</div>
            {nr.output && (
              <button
                type="button"
                onClick={() => copyField(`${run.id}::${nr.node}::output`, nr.output!)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors
                           text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]"
                title={t('flows.copy')}
              >
                {copiedKey === `${run.id}::${nr.node}::output`
                  ? <><Check className="w-3 h-3" />{t('flows.copied')}</>
                  : <><Copy className="w-3 h-3" />{t('flows.copy')}</>}
              </button>
            )}
          </div>
          {nr.output ? (
            <pre className="text-xs text-[var(--color-text)] bg-[var(--color-hover)] rounded-lg p-2
                           whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">{nr.output}</pre>
          ) : (
            <span className="text-xs text-[var(--color-text-dim)]">{t('flows.noOutput')}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-[var(--color-text-bright)] truncate">{name}</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
            {config.description || info.dir}
          </p>
        </div>
        <input
          type="text"
          value={inputsText}
          onChange={(e) => setInputsText(e.target.value)}
          placeholder={t('flows.inputsPlaceholder')}
          className="w-56 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                     px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                     focus:outline-none focus:border-[var(--color-blue)] transition-colors"
        />
        <button
          onClick={() => void exportCurrent()}
          className="p-2 rounded-lg bg-[var(--color-hover)] border border-[var(--color-border)]
                     text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title={t('flows.export')}
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={() => void runFlow()}
          disabled={running}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg
                     text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? t('flows.running') : t('flows.run')}
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Left: gate cards + canvas + run history */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Manual gate approval cards (a run may open several in a row) */}
          {gates.map((gate) => {
            const key = `${gate.runId}::${gate.node}`
            return (
              <div
                key={key}
                className="rounded-lg border border-[var(--color-yellow, #eab308)] bg-[var(--color-card)] p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="w-4 h-4 text-[var(--color-yellow, #eab308)]" />
                  <span className="text-sm font-medium text-[var(--color-text-bright)]">
                    {t('flows.manualGateTitle')}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">{gate.node}</span>
                  <span className="text-xs text-[var(--color-text-dim)]">
                    {t('flows.gateRunId', { id: gate.runId.slice(0, 8) })}
                  </span>
                </div>
                {gate.message && (
                  <p className="text-xs text-[var(--color-text-muted)] mb-2 whitespace-pre-wrap">
                    {gate.message}
                  </p>
                )}
                <textarea
                  value={gateNotes[key] ?? ''}
                  onChange={(e) => setGateNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                  rows={2}
                  placeholder={t('flows.gateNotePlaceholder')}
                  className={`${inputCls} resize-y mb-2`}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => void respondGate(gate.runId, gate.node, false)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium
                               border border-[var(--color-red)] text-[var(--color-red)]
                               hover:bg-[var(--color-red)]/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('flows.reject')}
                  </button>
                  <button
                    onClick={() => void respondGate(gate.runId, gate.node, true)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium
                               bg-[var(--color-green)] text-[var(--color-bg)] hover:opacity-90 transition-opacity"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t('flows.approve')}
                  </button>
                </div>
              </div>
            )
          })}

          <FlowCanvas
            config={config}
            statuses={liveStatuses}
            running={running}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onNodePosition={(nodeName, position) => updateNode(nodeName, { position })}
          />

          {/* Run history */}
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-bright)] mb-2">
              {t('flows.runs')}
              <span className="ml-2 text-xs font-normal text-[var(--color-text-dim)]">{t('flows.runsClickHint')}</span>
            </h2>
            {lastRuns.length === 0 ? (
              <p className="text-xs text-[var(--color-text-dim)]">{t('flows.noRuns')}</p>
            ) : (
              <div className="space-y-2">
                {lastRuns.map((run: FlowRun) => (
                  <div
                    key={run.id}
                    className="border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      {statusBadge(run.status)}
                      <span className="text-[var(--color-text-dim)]">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                      {run.resumedFrom && (
                        <span className="text-[var(--color-blue)]">↻ resumed</span>
                      )}
                      {(run.status === 'failed' || run.status === 'partial') && !running && (
                        <button
                          onClick={() => void runFlow(run.id)}
                          className="flex items-center gap-1 ml-auto px-2 py-0.5 rounded text-[var(--color-blue)]
                                     hover:bg-[var(--color-blue)]/10 font-medium transition-colors"
                          title={t('flows.resumeDesc')}
                        >
                          <RotateCcw className="w-3 h-3" />
                          {t('flows.resume')}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.values(run.nodes).map((nr) => {
                        const selected = inspect?.runId === run.id && inspect.node === nr.node
                        return (
                          <button
                            key={nr.node}
                            type="button"
                            onClick={() => setInspect(selected ? null : { runId: run.id, node: nr.node })}
                            title={nr.error ?? nr.output ?? ''}
                            className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors hover:bg-[var(--color-hover)]
                                        ring-1 ring-inset ${selected ? 'ring-[var(--color-blue)]' : 'ring-transparent'} ${nodeStatusCls(nr.status)}`}
                          >
                            {nodeStatusIcon(nr.status)} {nr.node}
                          </button>
                        )
                      })}
                    </div>
                    {inspect?.runId === run.id && run.nodes[inspect.node] && nodeInspector(run, run.nodes[inspect.node])}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: node editor */}
        <div className="w-80 shrink-0 border border-[var(--color-border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text-bright)]">{t('flows.nodeEditor')}</h2>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder={t('flows.nodeName')}
                className="w-24 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                           px-2 py-1 text-xs text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                           focus:outline-none focus:border-[var(--color-blue)] transition-colors"
              />
              <button
                onClick={addNode}
                disabled={saving}
                className="p-1.5 rounded-lg bg-[var(--color-hover)] hover:bg-[var(--color-border)]
                           text-[var(--color-text)] disabled:opacity-50 transition-colors"
                title={t('flows.addNode')}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!node ? (
            <p className="text-xs text-[var(--color-text-dim)] py-6 text-center">{t('flows.noNodeSelected')}</p>
          ) : (
            <>
              <div className="text-sm font-medium text-[var(--color-text-bright)]">{selectedNode}</div>

              <div>
                <label className={labelCls}>{t('flows.nodeType')}</label>
                <select
                  value={node.type}
                  onChange={(e) => updateNode(selectedNode!, { type: e.target.value as FlowNode['type'] })}
                  className={inputCls}
                >
                  <option value="ai">ai</option>
                  <option value="script">script</option>
                  <option value="manual">manual</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>{t('flows.nodeNeeds')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {nodeNames.filter((n) => n !== selectedNode).map((n) => {
                    const need = node.needs?.find((x) => edgeTarget(x) === n)
                    const cond = need ? edgeCondition(need) : null
                    // Click cycles: none -> success -> failure -> finished -> none
                    const cycle = () => {
                      const others = (node.needs ?? []).filter((x) => edgeTarget(x) !== n)
                      if (!need) {
                        updateNode(selectedNode!, { needs: [...others, { node: n, on: 'success' as const }] })
                      } else if (cond === 'success') {
                        updateNode(selectedNode!, { needs: [...others, { node: n, on: 'failure' as const }] })
                      } else if (cond === 'failure') {
                        updateNode(selectedNode!, { needs: [...others, { node: n, on: 'finished' as const }] })
                      } else {
                        updateNode(selectedNode!, { needs: others.length > 0 ? others : undefined })
                      }
                    }
                    const condMeta =
                      cond === 'failure'
                        ? { icon: ' ✗', cls: 'bg-[var(--color-red)]/20 text-[var(--color-red)]', title: t('flows.condFailure') }
                        : cond === 'finished'
                          ? { icon: ' •', cls: 'bg-[var(--color-hover)] text-[var(--color-text)]', title: t('flows.condFinished') }
                          : { icon: ' ✓', cls: 'bg-[var(--color-blue)] text-[var(--color-bg)]', title: t('flows.condSuccess') }
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={cycle}
                        title={need ? condMeta.title : t('flows.condAdd')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          need ? condMeta.cls : 'bg-[var(--color-hover)] text-[var(--color-text-dim)]'
                        }`}
                      >
                        {n}{need ? condMeta.icon : ' +'}
                      </button>
                    )
                  })}
                  {nodeNames.length <= 1 && (
                    <span className="text-xs text-[var(--color-text-dim)]">-</span>
                  )}
                </div>
              </div>

              {node.type === 'ai' && (
                <>
                  <div>
                    <label className={labelCls}>{t('flows.nodeTask')}</label>
                    <input
                      type="text"
                      defaultValue={node.task}
                      onBlur={(e) => updateNode(selectedNode!, { task: e.target.value.trim() || undefined })}
                      className={inputCls}
                      placeholder={t('flows.nodeTaskPlaceholder')}
                    />
                    <p className="text-xs text-[var(--color-text-dim)] mt-1">
                      {node.task ? t('flows.nodeTaskRefHint') : t('flows.nodeTaskInlineHint')}
                    </p>
                  </div>
                  <div>
                    <label className={labelCls}>{t('flows.nodeModel')}</label>
                    <input
                      type="text"
                      defaultValue={node.model}
                      onBlur={(e) => updateNode(selectedNode!, { model: e.target.value.trim() || undefined })}
                      className={`${inputCls} font-mono`}
                      placeholder={t('flows.nodeModelPlaceholder')}
                    />
                    <p className="text-xs text-[var(--color-text-dim)] mt-1">
                      {t('flows.nodeModelHint')}
                    </p>
                  </div>
                  <div>
                    <label className={labelCls}>
                      {t('flows.nodePromptTemplate')}
                      {!node.task && <span className="text-[var(--color-red)]"> *</span>}
                    </label>
                    <textarea
                      defaultValue={node.promptTemplate}
                      onBlur={(e) => updateNode(selectedNode!, { promptTemplate: e.target.value || undefined })}
                      rows={4}
                      className={`${inputCls} resize-y font-mono`}
                      placeholder="{upstream.output}"
                    />
                  </div>
                  {(node.needs ?? []).length > 0 && (
                    <div>
                      <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={node.injectUpstream ?? true}
                          onChange={(e) => updateNode(selectedNode!, { injectUpstream: e.target.checked })}
                          className="accent-[var(--color-blue)]"
                        />
                        {t('flows.injectUpstream')}
                      </label>
                      <p className="text-xs text-[var(--color-text-dim)] mt-1">
                        {t('flows.injectUpstreamHint')}
                      </p>
                    </div>
                  )}
                </>
              )}

              {node.type === 'script' && (
                <div>
                  <label className={labelCls}>{t('flows.nodeRun')}</label>
                  <input
                    type="text"
                    defaultValue={node.run}
                    onBlur={(e) => updateNode(selectedNode!, { run: e.target.value })}
                    className={`${inputCls} font-mono`}
                    placeholder="echo hello"
                  />
                </div>
              )}

              {node.type === 'manual' && (
                <>
                  {!node.aiTakeover && (
                    <div>
                      <label className={labelCls}>{t('flows.nodeGatePrompt')}</label>
                      <textarea
                        defaultValue={node.gatePrompt}
                        onBlur={(e) => updateNode(selectedNode!, { gatePrompt: e.target.value || undefined })}
                        rows={2}
                        className={`${inputCls} resize-y`}
                        placeholder={t('flows.gatePromptPlaceholder')}
                      />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={node.aiTakeover ?? false}
                      onChange={(e) => updateNode(selectedNode!, { aiTakeover: e.target.checked })}
                      className="accent-[var(--color-blue)]"
                    />
                    {t('flows.nodeTakeover')}
                  </label>
                  {node.aiTakeover && (
                    <div>
                      <label className={labelCls}>{t('flows.nodeTakeoverPrompt')}</label>
                      <textarea
                        defaultValue={node.takeoverPrompt}
                        onBlur={(e) => updateNode(selectedNode!, { takeoverPrompt: e.target.value || undefined })}
                        rows={3}
                        className={`${inputCls} resize-y`}
                      />
                      {(node.needs ?? []).length > 0 && (
                        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer mt-2">
                          <input
                            type="checkbox"
                            checked={node.injectUpstream ?? true}
                            onChange={(e) => updateNode(selectedNode!, { injectUpstream: e.target.checked })}
                            className="accent-[var(--color-blue)]"
                          />
                          {t('flows.injectUpstream')}
                        </label>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center justify-between pt-1">
                <div>
                  <label className={labelCls}>{t('flows.onFailure')}</label>
                  <select
                    value={node.onFailure ?? 'stop'}
                    onChange={(e) => updateNode(selectedNode!, { onFailure: e.target.value as 'stop' | 'continue' })}
                    className={inputCls}
                  >
                    <option value="stop">{t('flows.onFailureStop')}</option>
                    <option value="continue">{t('flows.onFailureContinue')}</option>
                  </select>
                </div>
                <button
                  onClick={() => void deleteNode(selectedNode!)}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 mt-4 rounded-lg text-xs font-medium
                             text-[var(--color-red)] hover:bg-[var(--color-red)]/10
                             disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('flows.deleteNode')}
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
                <Save className="w-3 h-3" />
                {t('flows.autosave')}
              </div>
            </>
          )}

          {error && (
            <div className="text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2 break-all">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
