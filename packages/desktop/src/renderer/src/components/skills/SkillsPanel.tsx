import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Plus, Upload, Download, Copy, Trash2, Pencil, X, FolderKanban } from 'lucide-react'
import type { SkillEntry, SkillWorkspaceRef, SkillWorkspaceKind } from '../../../../shared/ipc-types'
import { useI18n } from '../../hooks/useI18n'
import { useTasks } from '../../hooks/useTasks'
import { useFlows } from '../../hooks/useFlows'

const inputCls = `w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`
const labelCls = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1'

type ModalMode = 'edit' | 'create' | 'copy' | 'import'

interface ModalState {
  mode: ModalMode
  entry: SkillEntry | null
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: 描述这个技能做什么、什么时候用
---

## What I do
- 

## When to use me
- 

## Instructions
- 
`
}

/** Grouped workspace picker: all tasks + all flows. */
function WorkspaceSelect({
  kind, workspace, onChange, exclude,
}: {
  kind: SkillWorkspaceKind
  workspace: string
  onChange: (ref: SkillWorkspaceRef) => void
  exclude?: SkillWorkspaceRef
}) {
  const { t } = useI18n()
  const { tasks } = useTasks()
  const { flows } = useFlows()
  const usable = (ref: SkillWorkspaceRef): boolean =>
    !(exclude && ref.kind === exclude.kind && ref.workspace === exclude.workspace)

  return (
    <select
      value={workspace ? `${kind}:${workspace}` : ''}
      onChange={(e) => {
        const [k, ...rest] = e.target.value.split(':')
        if (rest.length > 0) onChange({ kind: k as SkillWorkspaceKind, workspace: rest.join(':') })
      }}
      className={inputCls}
    >
      <option value="">{t('skills.pickWorkspace')}</option>
      <optgroup label={t('skills.tasksGroup')}>
        {tasks.map((task) => {
          const ref = { kind: 'task' as const, workspace: task.config.name }
          return usable(ref) ? <option key={`task:${ref.workspace}`} value={`task:${ref.workspace}`}>{ref.workspace}</option> : null
        })}
      </optgroup>
      <optgroup label={t('skills.flowsGroup')}>
        {flows.map((f) => {
          const ref = { kind: 'flow' as const, workspace: f.config.name }
          return usable(ref) ? <option key={`flow:${ref.workspace}`} value={`flow:${ref.workspace}`}>{ref.workspace}</option> : null
        })}
      </optgroup>
    </select>
  )
}

export default function SkillsPanel() {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)

  // Modal form state
  const [target, setTarget] = useState<SkillWorkspaceRef>({ kind: 'task', workspace: '' })
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSkills(await window.api.listAllSkills())
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openModal = (mode: ModalMode, entry: SkillEntry | null): void => {
    setError(null)
    setSubmitting(false)
    setTarget({ kind: entry?.kind ?? 'task', workspace: entry?.workspace ?? '' })
    setName(entry?.name ?? '')
    setContent(entry?.content ?? skillTemplate('my-skill'))
    setModal({ mode, entry })
  }

  const closeModal = (): void => setModal(null)

  const submit = async (): Promise<void> => {
    if (!modal) return
    setError(null)
    setSubmitting(true)
    try {
      if (modal.mode === 'edit' && modal.entry) {
        await window.api.saveSkill(modal.entry, modal.entry.name, content)
      } else if (modal.mode === 'create') {
        if (!name.trim()) throw new Error(t('skills.nameRequired'))
        if (!target.workspace) throw new Error(t('skills.targetRequired'))
        await window.api.saveSkill(target, name.trim(), content)
      } else if (modal.mode === 'copy' && modal.entry) {
        if (!target.workspace) throw new Error(t('skills.targetRequired'))
        await window.api.copySkill(modal.entry, target)
      } else if (modal.mode === 'import') {
        if (!target.workspace) throw new Error(t('skills.targetRequired'))
        const res = await window.api.importSkill(target)
        if (!res.ok) {
          setSubmitting(false)
          closeModal()
          return
        }
      }
      closeModal()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const exportOne = async (entry: SkillEntry): Promise<void> => {
    try {
      await window.api.exportSkill(entry, entry.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const deleteOne = async (entry: SkillEntry): Promise<void> => {
    if (!window.confirm(t('skills.deleteConfirm', { name: entry.name, workspace: entry.workspace }))) return
    try {
      await window.api.deleteSkill(entry, entry.name)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const modalTitle =
    modal?.mode === 'edit' ? t('skills.editTitle') :
    modal?.mode === 'create' ? t('skills.createTitle') :
    modal?.mode === 'copy' ? t('skills.copyTitle') :
    t('skills.importTitle')

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">{t('skills.title')}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('skills.titleDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openModal('import', null)}
            className="flex items-center gap-1.5 px-4 py-1.5 border border-[var(--color-border)]
                       rounded-lg text-sm font-medium text-[var(--color-text)]
                       hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t('skills.import')}
          </button>
          <button
            onClick={() => openModal('create', null)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)]
                       rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            {t('skills.create')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2 break-all">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t('skills.loading')}</p>
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-dim)]">
          <Sparkles className="w-10 h-10 mb-3 opacity-50" />
          <p className="text-sm">{t('skills.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {skills.map((s) => (
            <div
              key={`${s.kind}:${s.workspace}:${s.name}`}
              className="group border border-[var(--color-border)] rounded-xl p-4 bg-[var(--color-card)]"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text-bright)] truncate">{s.name}</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1 truncate">
                    <FolderKanban className="w-3 h-3 shrink-0" />
                    {s.kind === 'task' ? t('skills.taskBadge') : t('skills.flowBadge')} · {s.workspace}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openModal('edit', s)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-dim)]
                               hover:text-[var(--color-blue)] transition-all"
                    title={t('skills.edit')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openModal('copy', s)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-dim)]
                               hover:text-[var(--color-blue)] transition-all"
                    title={t('skills.copy')}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void exportOne(s)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-dim)]
                               hover:text-[var(--color-blue)] transition-all"
                    title={t('skills.export')}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void deleteOne(s)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-dim)]
                               hover:text-[var(--color-red)] transition-all"
                    title={t('skills.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-dim)] mt-3 line-clamp-2 whitespace-pre-wrap">
                {s.content
                  ? (s.content.split('\n').find((l: string) => l.startsWith('description:'))?.replace(/^description:\s*/, '') ?? t('skills.noDescription'))
                  : t('skills.missingFile')}
              </p>
              {s.extraFiles > 0 && (
                <p className="text-xs text-[var(--color-text-dim)] mt-1">
                  +{s.extraFiles} {t('skills.extraFiles')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeModal}>
          <div
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{modalTitle}</h2>
              <button onClick={closeModal} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg">
                ×
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              {modal.mode === 'edit' && modal.entry && (
                <>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {modal.entry.kind === 'task' ? t('skills.taskBadge') : t('skills.flowBadge')} · {modal.entry.workspace} / {modal.entry.name}
                  </p>
                  <div>
                    <label className={labelCls}>{t('skills.content')}</label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={16}
                      className={`${inputCls} resize-y font-mono text-xs`}
                      spellCheck={false}
                    />
                  </div>
                </>
              )}

              {modal.mode === 'create' && (
                <>
                  <div>
                    <label className={labelCls}>{t('skills.target')}</label>
                    <WorkspaceSelect kind={target.kind} workspace={target.workspace} onChange={setTarget} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('skills.name')} <span className="text-[var(--color-red)]">*</span></label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-skill"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{t('skills.content')}</label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={12}
                      className={`${inputCls} resize-y font-mono text-xs`}
                      spellCheck={false}
                    />
                  </div>
                </>
              )}

              {modal.mode === 'copy' && modal.entry && (
                <>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t('skills.copySource', { name: modal.entry.name, workspace: modal.entry.workspace })}
                  </p>
                  <div>
                    <label className={labelCls}>{t('skills.target')}</label>
                    <WorkspaceSelect
                      kind={target.kind}
                      workspace={target.workspace}
                      onChange={setTarget}
                      exclude={modal.entry}
                    />
                  </div>
                </>
              )}

              {modal.mode === 'import' && (
                <div>
                  <label className={labelCls}>{t('skills.target')}</label>
                  <WorkspaceSelect kind={target.kind} workspace={target.workspace} onChange={setTarget} />
                  <p className="text-xs text-[var(--color-text-dim)] mt-2">{t('skills.importHint')}</p>
                </div>
              )}

              {error && (
                <div className="text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2 break-all">
                  {error}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
              <button
                onClick={closeModal}
                className="px-4 py-1.5 rounded-lg text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors"
              >
                {t('create.cancel')}
              </button>
              <button
                onClick={() => void submit()}
                disabled={submitting}
                className="px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg text-sm font-medium
                           hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {modal.mode === 'edit' ? t('skills.save') : t('skills.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
