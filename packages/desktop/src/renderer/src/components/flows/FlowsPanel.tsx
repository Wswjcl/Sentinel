import { useState } from 'react'
import { Plus, Trash2, Workflow, Clock } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useFlows } from '../../hooks/useFlows'
import FlowDetail from './FlowDetail'

const inputCls = `w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`
const labelCls = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1'

function CreateFlowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduleType, setScheduleType] = useState<'none' | 'cron' | 'interval' | 'once'>('none')
  const [scheduleExpr, setScheduleExpr] = useState('0 9 * * *')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
      setError(t('flows.nameInvalid'))
      return
    }
    setSubmitting(true)
    try {
      await window.api.saveFlow(name.trim(), {
        name: name.trim(),
        description: description.trim() || undefined,
        version: 1,
        ...(scheduleType !== 'none' ? { schedule: { type: scheduleType, expr: scheduleExpr } } : {}),
        // Start with one script node - the editor requires at least one
        nodes: { start: { type: 'script', run: 'echo hello from ' + name.trim() } },
      })
      onCreated(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{t('flows.createTitle')}</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>{t('flows.name')} <span className="text-[var(--color-red)]">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-flow" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('flows.description')}</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('flows.descriptionPlaceholder')} className={inputCls} />
          </div>
          <div className="flex gap-3">
            <div className="w-28">
              <label className={labelCls}>{t('flows.scheduleType')}</label>
              <select
                value={scheduleType}
                onChange={(e) => {
                  const val = e.target.value as typeof scheduleType
                  setScheduleType(val)
                  if (val === 'interval') setScheduleExpr('1h')
                  else if (val === 'once') setScheduleExpr('now')
                  else if (val === 'cron') setScheduleExpr('0 9 * * *')
                }}
                className={inputCls}
              >
                <option value="none">{t('flows.scheduleNone')}</option>
                <option value="cron">{t('flows.scheduleCron')}</option>
                <option value="interval">{t('flows.scheduleInterval')}</option>
                <option value="once">{t('flows.scheduleOnce')}</option>
              </select>
            </div>
            <div className="flex-1">
              <label className={labelCls}>{t('flows.scheduleExpr')}</label>
              <input
                type="text"
                value={scheduleExpr}
                onChange={(e) => setScheduleExpr(e.target.value)}
                disabled={scheduleType === 'none'}
                className={`${inputCls} disabled:opacity-40`}
              />
            </div>
          </div>
          {error && (
            <div className="text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-lg text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors">
              {t('create.cancel')}
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {t('flows.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function FlowsPanel() {
  const { t } = useI18n()
  const { flows, loading, refresh } = useFlows()
  const [selected, setSelected] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  if (selected) {
    return <FlowDetail name={selected} onBack={() => { setSelected(null); refresh() }} />
  }

  const lastRunStatus = (runs: { status: string; startedAt: string }[]) => {
    const last = runs[runs.length - 1]
    if (!last) return null
    const cls =
      last.status === 'success' ? 'text-[var(--color-green)]' :
      last.status === 'failed' ? 'text-[var(--color-red)]' :
      last.status === 'partial' ? 'text-[var(--color-yellow, #eab308)]' :
      'text-[var(--color-blue)]'
    return <span className={`text-xs font-medium ${cls}`}>{t(`flows.flowStatus.${last.status}`)}</span>
  }

  const deleteFlow = async (name: string) => {
    if (!window.confirm(t('flows.deleteConfirm', { name }))) return
    await window.api.deleteFlow(name)
    refresh()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">{t('flows.title')}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('flows.titleDesc')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)]
                     rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          {t('flows.newFlow')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t('flows.loading')}</p>
      ) : flows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-dim)]">
          <Workflow className="w-10 h-10 mb-3 opacity-50" />
          <p className="text-sm">{t('flows.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {flows.map((f) => {
            const nodeCount = Object.keys(f.config.nodes ?? {}).length
            return (
              <div
                key={f.config.name}
                onClick={() => setSelected(f.config.name)}
                className="group border border-[var(--color-border)] rounded-xl p-4 cursor-pointer
                           hover:border-[var(--color-blue)] transition-colors bg-[var(--color-card)]"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--color-text-bright)] truncate">{f.config.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{f.config.description || '-'}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteFlow(f.config.name) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-dim)]
                               hover:text-[var(--color-red)] transition-all"
                    title={t('flows.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-[var(--color-text-dim)]">
                  <span>{t('flows.nodeCount', { count: nodeCount })}</span>
                  {f.config.schedule ? (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {f.config.schedule.expr}
                    </span>
                  ) : (
                    <span>{t('flows.scheduleNone')}</span>
                  )}
                  {lastRunStatus(f.runs)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateFlowDialog
          onClose={() => setShowCreate(false)}
          onCreated={(name) => { setShowCreate(false); setSelected(name) }}
        />
      )}
    </div>
  )
}
