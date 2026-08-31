import { useState } from 'react'
import { X } from 'lucide-react'
import type { CreateTaskOpts } from '../../../../shared/ipc-types'
import { useI18n } from '../../hooks/useI18n'
import { useModelOptions } from '../../hooks/useModels'
import ScheduleEditor, { type ScheduleValue } from './ScheduleEditor'

const AVAILABLE_AGENTS = ['build', 'plan', 'explore', 'general']
const AVAILABLE_TOOLS = [
  'bash', 'read', 'edit', 'glob', 'grep',
  'webfetch', 'websearch', 'skill', 'todowrite', 'question',
]

interface CreateTaskDialogProps {
  onClose: () => void
  onCreated: () => void
}

export default function CreateTaskDialog({ onClose, onCreated }: CreateTaskDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schedule, setSchedule] = useState<ScheduleValue>({ type: 'cron', expr: '*/30 * * * *' })
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState('build')
  const [skills, setSkills] = useState('')
  const [sessionMode, setSessionMode] = useState<'fresh' | 'continue' | 'fork'>('fresh')
  const [projectDir, setProjectDir] = useState('')
  const [allowTools, setAllowTools] = useState<string[]>(AVAILABLE_TOOLS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [verifyType, setVerifyType] = useState<'command' | 'llm'>('command')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [verifyCriteria, setVerifyCriteria] = useState('')
  const [maxIterations, setMaxIterations] = useState('3')
  const [onFailure, setOnFailure] = useState<'iterate' | 'notify' | 'stop'>('iterate')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()
  const modelOptions = useModelOptions()

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
    if (loopEnabled) {
      if (verifyType === 'command' && !verifyCommand.trim()) {
        setError(t('create.verifyCommandRequired'))
        return
      }
      if (verifyType === 'llm' && !verifyCriteria.trim()) {
        setError(t('create.verifyCriteriaRequired'))
        return
      }
    }

    setSubmitting(true)
    try {
      const skillList = skills.trim() ? skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const opts: CreateTaskOpts = {
        name: name.trim(),
        description: description.trim() || undefined,
        projectDir: projectDir.trim() || undefined,
        schedule: { type: schedule.type, expr: schedule.expr, timezone: schedule.timezone, interval: schedule.interval, maxRuns: schedule.maxRuns },
        execution: {
          prompt: prompt.trim(),
          model: model.trim() || undefined,
          agent: agent !== 'build' ? agent : undefined,
          skills: skillList,
          session: sessionMode !== 'fresh' ? sessionMode : undefined,
        },
        skills: skillList,
        allowTools: allowTools.length < AVAILABLE_TOOLS.length ? allowTools : undefined,
        agentLoop: loopEnabled
          ? {
              enabled: true,
              maxIterations: parseInt(maxIterations, 10) || 3,
              verification: {
                type: verifyType,
                command: verifyType === 'command' ? verifyCommand.trim() : undefined,
                criteria: verifyType === 'llm' ? verifyCriteria.trim() : undefined,
                onFailure,
              },
            }
          : undefined,
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

  const toggleTool = (tool: string) => {
    setAllowTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-card)] z-10">
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
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.scheduleType')}
            </label>
            <ScheduleEditor value={schedule} onChange={setSchedule} />
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

          {/* Model + Agent row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                {t('create.model')}
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('create.modelPlaceholder')}
                list="task-model-options"
                className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                           px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                           focus:outline-none focus:border-[var(--color-blue)] transition-colors"
              />
              <datalist id="task-model-options">
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.free ? `${m.value} · ${t('models.free')}` : m.value}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                {t('create.agent')}
              </label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                           px-3 py-1.5 text-sm text-[var(--color-text)]
                           focus:outline-none focus:border-[var(--color-blue)] transition-colors"
              >
                {AVAILABLE_AGENTS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.skills')}
            </label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder={t('create.skillsPlaceholder')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            />
          </div>

          {/* Session continuity */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              {t('create.session')}
            </label>
            <select
              value={sessionMode}
              onChange={(e) => setSessionMode(e.target.value as 'fresh' | 'continue' | 'fork')}
              className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                         px-3 py-1.5 text-sm text-[var(--color-text)]
                         focus:outline-none focus:border-[var(--color-blue)] transition-colors"
            >
              <option value="fresh">{t('create.sessionFresh')}</option>
              <option value="continue">{t('create.sessionContinue')}</option>
              <option value="fork">{t('create.sessionFork')}</option>
            </select>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-[var(--color-blue)] hover:underline"
          >
            {showAdvanced ? t('create.hideAdvanced') : t('create.showAdvanced')}
          </button>

          {/* Advanced: Permissions */}
          {showAdvanced && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-2">
                {t('create.permissions')}
              </label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      allowTools.includes(tool)
                        ? 'bg-[var(--color-green)] text-[var(--color-bg)]'
                        : 'bg-[var(--color-hover)] text-[var(--color-text-dim)] line-through'
                    }`}
                  >
                    {tool}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advanced: Agent Loop (Loop Engineering) */}
          {showAdvanced && (
            <div className="border-t border-[var(--color-border)] pt-3">
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={loopEnabled}
                  onChange={(e) => setLoopEnabled(e.target.checked)}
                  className="accent-[var(--color-blue)]"
                />
                {t('create.loopEnable')} — {t('create.agentLoop')}
              </label>

              {loopEnabled && (
                <div className="space-y-3 mt-3">
                  <div className="flex gap-3">
                    <div className="w-36">
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        {t('create.verifyType')}
                      </label>
                      <select
                        value={verifyType}
                        onChange={(e) => setVerifyType(e.target.value as 'command' | 'llm')}
                        className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                                   px-3 py-1.5 text-sm text-[var(--color-text)]
                                   focus:outline-none focus:border-[var(--color-blue)] transition-colors"
                      >
                        <option value="command">command</option>
                        <option value="llm">llm</option>
                      </select>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        {t('create.maxIterations')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={maxIterations}
                        onChange={(e) => setMaxIterations(e.target.value)}
                        className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                                   px-3 py-1.5 text-sm text-[var(--color-text)]
                                   focus:outline-none focus:border-[var(--color-blue)] transition-colors"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        {t('create.onFailure')}
                      </label>
                      <select
                        value={onFailure}
                        onChange={(e) => setOnFailure(e.target.value as 'iterate' | 'notify' | 'stop')}
                        className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                                   px-3 py-1.5 text-sm text-[var(--color-text)]
                                   focus:outline-none focus:border-[var(--color-blue)] transition-colors"
                      >
                        <option value="iterate">{t('create.onFailureIterate')}</option>
                        <option value="notify">{t('create.onFailureNotify')}</option>
                        <option value="stop">{t('create.onFailureStop')}</option>
                      </select>
                    </div>
                  </div>

                  {verifyType === 'command' ? (
                    <div>
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        {t('create.verifyCommand')} <span className="text-[var(--color-red)]">*</span>
                      </label>
                      <input
                        type="text"
                        value={verifyCommand}
                        onChange={(e) => setVerifyCommand(e.target.value)}
                        placeholder={t('create.verifyCommandPlaceholder')}
                        className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                                   px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)] font-mono
                                   focus:outline-none focus:border-[var(--color-blue)] transition-colors"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        {t('create.verifyCriteria')} <span className="text-[var(--color-red)]">*</span>
                      </label>
                      <textarea
                        value={verifyCriteria}
                        onChange={(e) => setVerifyCriteria(e.target.value)}
                        placeholder={t('create.verifyCriteriaPlaceholder')}
                        rows={3}
                        className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                                   px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)] resize-y
                                   focus:outline-none focus:border-[var(--color-blue)] transition-colors"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
