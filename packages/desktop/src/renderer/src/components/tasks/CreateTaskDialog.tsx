import { useState } from 'react'
import { X } from 'lucide-react'
import type { CreateTaskOpts } from '../../../shared/ipc-types'
import { useI18n } from '../../hooks/useI18n'

interface CreateTaskDialogProps {
  onClose: () => void
  onCreated: () => void
}

export default function CreateTaskDialog({ onClose, onCreated }: CreateTaskDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('cron')
  const [scheduleExpr, setScheduleExpr] = useState('*/30 * * * *')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [projectDir, setProjectDir] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate name
    if (!name.trim()) {
      setError(t('create.nameRequired'))
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError(t('create.nameInvalid'))
      return
    }
    if (!prompt.trim()) {
      setError(t('create.promptRequired'))
      return
    }
    if (!projectDir.trim()) {
      setError(t('create.projectDirRequired'))
      return
    }

    setSubmitting(true)
    try {
      const opts: CreateTaskOpts = {
        name: name.trim(),
        description: description.trim() || undefined,
        projectDir: projectDir.trim() || undefined,
        schedule: { type: scheduleType, expr: scheduleExpr },
        execution: {
          prompt: prompt.trim(),
          model: model.trim() || undefined,
        },
      }
      const result = await window.api.createTask(opts)
      if (result.ok) {
        onCreated()
      } else {
        setError(t('create.failed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-lg mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{t('create.title')}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.name')} <span className="text-[var(--color-red)]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.namePlaceholder')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.description')}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('create.descriptionPlaceholder')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Project directory */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.projectDir')} <span className="text-[var(--color-red)]">*</span>
            </label>
            <input
              type="text"
              value={projectDir}
              onChange={(e) => setProjectDir(e.target.value)}
              placeholder={t('create.projectDirPlaceholder')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Schedule */}
          <div className="flex gap-3">
            <div className="w-28">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                {t('create.scheduleType')}
              </label>
              <select
                value={scheduleType}
                onChange={(e) => {
                  const t = e.target.value as 'cron' | 'interval' | 'once'
                  setScheduleType(t)
                  if (t === 'interval') setScheduleExpr('30m')
                  else if (t === 'once') setScheduleExpr('now')
                  else setScheduleExpr('*/30 * * * *')
                }}
                className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                           px-3 py-1.5 text-sm text-[var(--color-text)]
                           focus:outline-none focus:border-[var(--color-blue)] transition-colors"
              >
                <option value="cron">{t('create.cron')}</option>
                <option value="interval">{t('create.interval')}</option>
                <option value="once">{t('create.once')}</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                {t('create.expression')}
              </label>
              <input
                type="text"
                value={scheduleExpr}
                onChange={(e) => setScheduleExpr(e.target.value)}
                placeholder={t('create.expressionPlaceholder')}
                className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                           px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                           focus:outline-none focus:border-[var(--color-blue)] transition-colors"
              />
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.prompt')} <span className="text-[var(--color-red)]">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('create.promptPlaceholder')}
              rows={4}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)] resize-y
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.model')}
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('create.modelPlaceholder')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors"
            >
              {t('create.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg text-sm font-medium
                         hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? t('create.creating') : t('create.createTask')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
