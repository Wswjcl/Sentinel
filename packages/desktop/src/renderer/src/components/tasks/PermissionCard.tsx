import { useEffect, useState } from 'react'
import { Plus, X, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { PermissionProfile, PermissionPreset, PermissionLevel } from '@sentinel/core'

const inputCls = `bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                  px-3 py-1.5 text-sm text-[var(--color-text)]
                  focus:outline-none focus:border-[var(--color-blue)] transition-colors`
const labelCls = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1'

const PRESETS: PermissionPreset[] = ['readonly', 'standard', 'trusted', 'custom']

export interface PermissionCardProps {
  kind: 'task' | 'flow'
  name: string
}

/** Permission card: pick a preset (or a custom combination of writable
 *  globs and tool policies). Changes compile straight into the workspace's
 *  .opencode config (task dir or flow dir), which opencode enforces
 *  natively. For flows this governs inline AI nodes and AI takeover;
 *  referenced-task nodes keep using the referenced task's own card. */
export default function PermissionCard({ kind, name }: PermissionCardProps) {
  const { t } = useI18n()
  const [profile, setProfile] = useState<PermissionProfile | null>(null)
  const [applied, setApplied] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [globDraft, setGlobDraft] = useState('')

  useEffect(() => {
    const api = kind === 'flow' ? window.api.getFlowPermission : window.api.getTaskPermission
    api(name)
      .then((r) => {
        setProfile(r.profile)
        setApplied(r.applied)
      })
      .catch(() => setProfile(null))
      .finally(() => setLoaded(true))
  }, [kind, name])

  const save = async (next: PermissionProfile | null): Promise<void> => {
    setSaving(true)
    try {
      const api = kind === 'flow' ? window.api.setFlowPermission : window.api.setTaskPermission
      await api(name, next)
      setProfile(next)
      setApplied(next !== null)
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  const preset = profile?.preset

  const updateCustom = (patch: Partial<PermissionProfile>): void => {
    if (preset !== 'custom' || !profile) return
    setProfile({ ...profile, ...patch })
  }

  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wider">
        {t('detail.permTitle')}
        <span
          className={`ml-2 inline-flex items-center gap-1 normal-case tracking-normal text-[10px] px-1.5 py-0.5 rounded ${
            applied ? 'text-[var(--color-green)]' : 'text-[var(--color-text-dim)]'
          }`}
          title={applied ? t('detail.permApplied') : t('detail.permNotApplied')}
        >
          <ShieldCheck className="w-3 h-3" />
          {applied ? t('detail.permApplied') : t('detail.permNotApplied')}
        </span>
      </h3>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 space-y-3">
        {/* Preset */}
        <div className="flex items-center gap-3">
          <select
            value={preset ?? ''}
            disabled={saving}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return void save(null)
              if (v === 'custom') {
                return void save({ preset: 'custom', bash: 'ask', external: 'ask', webfetch: 'ask', editGlobs: [] })
              }
              return void save({ preset: v as PermissionPreset })
            }}
            className="flex-1 bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                       px-3 py-1.5 text-sm text-[var(--color-text)]
                       focus:outline-none focus:border-[var(--color-blue)] transition-colors"
          >
            <option value="">{t('detail.permOff')}</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`detail.permPreset.${p}`)}
              </option>
            ))}
          </select>
          {saving && <span className="text-xs text-[var(--color-text-dim)]">{t('detail.saving')}</span>}
        </div>
        {preset && <p className="text-xs text-[var(--color-text-dim)]">{t(`detail.permDesc.${preset}`)}</p>}

        {/* Custom controls */}
        {preset === 'custom' && profile && (
          <div className="space-y-3 pt-1 border-t border-[var(--color-border)]">
            {/* Writable globs */}
            <div>
              <label className={labelCls}>{t('detail.permEditGlobs')}</label>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {(profile.editGlobs ?? []).map((g) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-hover)]
                               border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)]"
                  >
                    {g}
                    <button
                      onClick={() =>
                        updateCustom({ editGlobs: (profile.editGlobs ?? []).filter((x) => x !== g) })
                      }
                      className="text-[var(--color-text-dim)] hover:text-[var(--color-red)]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {(profile.editGlobs ?? []).length === 0 && (
                  <span className="text-xs text-[var(--color-text-dim)]">{t('detail.permNoGlobs')}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={globDraft}
                  onChange={(e) => setGlobDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && globDraft.trim()) {
                      e.preventDefault()
                      updateCustom({ editGlobs: [...(profile.editGlobs ?? []), globDraft.trim()] })
                      setGlobDraft('')
                    }
                  }}
                  placeholder="src/**"
                  className={`${inputCls} flex-1 font-mono`}
                />
                <button
                  onClick={() => {
                    if (!globDraft.trim()) return
                    updateCustom({ editGlobs: [...(profile.editGlobs ?? []), globDraft.trim()] })
                    setGlobDraft('')
                  }}
                  className="px-2 rounded-lg bg-[var(--color-hover)] hover:bg-[var(--color-border)]
                             text-[var(--color-text)] transition-colors"
                  title={t('detail.permAdd')}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Tool policies */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t('detail.permBash')}</label>
                <select
                  value={profile.bash ?? 'ask'}
                  onChange={(e) => updateCustom({ bash: e.target.value as PermissionLevel })}
                  className={`${inputCls} w-full`}
                >
                  {(['allow', 'ask', 'deny'] as PermissionLevel[]).map((v) => (
                    <option key={v} value={v}>{t(`detail.permLevel.${v}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('detail.permExternal')}</label>
                <select
                  value={profile.external ?? 'ask'}
                  onChange={(e) => updateCustom({ external: e.target.value as PermissionLevel })}
                  className={`${inputCls} w-full`}
                >
                  {(['allow', 'ask', 'deny'] as PermissionLevel[]).map((v) => (
                    <option key={v} value={v}>{t(`detail.permLevel.${v}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('detail.permWebfetch')}</label>
                <select
                  value={profile.webfetch ?? 'ask'}
                  onChange={(e) => updateCustom({ webfetch: e.target.value as PermissionLevel })}
                  className={`${inputCls} w-full`}
                >
                  {(['allow', 'ask', 'deny'] as PermissionLevel[]).map((v) => (
                    <option key={v} value={v}>{t(`detail.permLevel.${v}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Save custom changes (preset switches apply immediately) */}
            <div className="flex justify-end">
              <button
                onClick={() => void save(profile)}
                disabled={saving}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-[var(--color-green)] text-white
                           hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t('detail.permSave')}
              </button>
            </div>
          </div>
        )}
        <p className="text-xs text-[var(--color-text-dim)]">{t('detail.permHint')}</p>
      </div>
    </div>
  )
}
