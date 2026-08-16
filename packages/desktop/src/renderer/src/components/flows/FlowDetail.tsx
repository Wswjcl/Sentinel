import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Play, Plus, Trash2, Save } from 'lucide-react'
import type { FlowConfig, FlowNode, FlowNodeStatus, FlowRun } from '@sentinel/core'
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

  const refresh = useCallback(async () => {
    try {
      setInfo(await window.api.getFlow(name))
    } catch (err) {
      setError(String(err))
    }
  }, [name])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const unsub = window.api.onFlowUpdate((data) => {
      if (data.name !== name) return
      if (data.event === 'started') {
        setLiveStatuses({})
        setRunning(true)
      } else if (data.event === 'node-status-changed') {
        setLiveStatuses((prev) => ({ ...prev, [data.node]: data.status }))
      } else if (data.event === 'completed') {
        setRunning(false)
        refresh()
      }
    })
    return unsub
  }, [name, refresh])

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
      const needs = next.nodes[n].needs?.filter((d) => d !== nodeName)
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

  const runFlow = async () => {
    setError(null)
    const inputs: Record<string, string> = {}
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
    try {
      await window.api.runFlow(name, inputs)
      setRunning(true)
      setLiveStatuses({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const lastRuns = info.runs.slice(-5).reverse()
  const statusBadge = (s: string) => {
    const cls =
      s === 'success' ? 'text-[var(--color-green)]' :
      s === 'failed' ? 'text-[var(--color-red)]' :
      s === 'partial' ? 'text-[var(--color-yellow, #eab308)]' :
      'text-[var(--color-blue)]'
    return <span className={`font-medium ${cls}`}>{t(`flows.flowStatus.${s}`)}</span>
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
          onClick={runFlow}
          disabled={running}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg
                     text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          <Play className="w-3.5 h-3.5" />
          {running ? t('flows.running') : t('flows.run')}
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Left: canvas + run history */}
        <div className="flex-1 min-w-0 space-y-4">
          <FlowCanvas
            config={config}
            statuses={liveStatuses}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />

          {/* Run history */}
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-bright)] mb-2">{t('flows.runs')}</h2>
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
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.values(run.nodes).map((nr) => (
                        <span
                          key={nr.node}
                          title={nr.error ?? nr.output ?? ''}
                          className={`px-1.5 py-0.5 rounded ${
                            nr.status === 'success' ? 'text-[var(--color-green)]' :
                            nr.status === 'failed' ? 'text-[var(--color-red)]' :
                            nr.status === 'running' ? 'text-[var(--color-blue)]' :
                            'text-[var(--color-text-dim)]'
                          }`}
                        >
                          {nr.status === 'success' ? '✓' : nr.status === 'failed' ? '✗' : nr.status === 'running' ? '◉' : '⏭'} {nr.node}
                        </span>
                      ))}
                    </div>
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
                    const active = node.needs?.includes(n) ?? false
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          const needs = active
                            ? (node.needs ?? []).filter((d) => d !== n)
                            : [...(node.needs ?? []), n]
                          updateNode(selectedNode!, { needs: needs.length > 0 ? needs : undefined })
                        }}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          active
                            ? 'bg-[var(--color-blue)] text-[var(--color-bg)]'
                            : 'bg-[var(--color-hover)] text-[var(--color-text-dim)]'
                        }`}
                      >
                        {n}
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
                      onBlur={(e) => updateNode(selectedNode!, { task: e.target.value.trim() })}
                      className={inputCls}
                      placeholder="my-task"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{t('flows.nodePromptTemplate')}</label>
                    <textarea
                      defaultValue={node.promptTemplate}
                      onBlur={(e) => updateNode(selectedNode!, { promptTemplate: e.target.value || undefined })}
                      rows={4}
                      className={`${inputCls} resize-y font-mono`}
                      placeholder="{upstream.output}"
                    />
                  </div>
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
