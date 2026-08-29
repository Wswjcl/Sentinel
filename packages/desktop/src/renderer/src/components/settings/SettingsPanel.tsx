import { useState, useEffect } from 'react'
import { FolderOpen, Sun, Moon, Zap, Terminal, Pencil, RotateCcw, Check, AlertCircle } from 'lucide-react'
import { useTheme, type Theme } from '../../hooks/useTheme'
import { useI18n, type Locale, LOCALE_LABELS } from '../../hooks/useI18n'
import type { RuntimeMode, TasksDirInfo } from '../../../../shared/ipc-types'

export default function SettingsPanel() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const [version, setVersion] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('cli')
  const [dirInfo, setDirInfo] = useState<TasksDirInfo | null>(null)
  const [pickedDir, setPickedDir] = useState<string | null>(null)
  const [migrate, setMigrate] = useState(true)
  const [dirBusy, setDirBusy] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [dirSaved, setDirSaved] = useState(false)

  useEffect(() => {
    window.api.getAppVersion().then(setVersion).catch(() => setVersion('unknown'))
    window.api.getAppDataDir().then(setDataDir).catch(() => setDataDir(''))
    window.api.getRuntimeMode().then(setRuntimeMode).catch(() => setRuntimeMode('cli'))
    window.api.getTasksDirInfo().then(setDirInfo).catch(() => setDirInfo(null))
  }, [])

  const refreshDirInfo = () => {
    window.api.getTasksDirInfo().then(setDirInfo).catch(() => {})
  }

  const pickTasksDir = async () => {
    setDirError(null)
    setDirSaved(false)
    const dir = await window.api.chooseTasksDir()
    if (dir) setPickedDir(dir)
  }

  const applyTasksDir = async (dir: string, doMigrate: boolean) => {
    setDirBusy(true)
    setDirError(null)
    try {
      await window.api.setTasksDir(dir, doMigrate)
      setPickedDir(null)
      setDirSaved(true)
      refreshDirInfo()
    } catch (err) {
      setDirError(err instanceof Error ? err.message : String(err))
    } finally {
      setDirBusy(false)
    }
  }

  const changeRuntimeMode = async (mode: RuntimeMode) => {
    setRuntimeMode(mode)
    await window.api.setRuntimeMode(mode)
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-[var(--color-text-bright)] mb-1">{t('settings.title')}</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        {t('settings.description')}
      </p>

      {/* Application info */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          {t('settings.application')}
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('settings.version')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">{t('settings.versionDesc')}</div>
            </div>
            <span className="text-sm text-[var(--color-text-bright)] font-mono">v{version}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('settings.runtime')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">{t('settings.runtimeDesc')}</div>
            </div>
            <span className="text-sm text-[var(--color-text-bright)] font-mono">{t('settings.desktop')}</span>
          </div>

          {/* Runtime mode selector */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('detail.runtimeMode')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">
                {runtimeMode === 'serve' ? t('detail.runtimeServe') : t('detail.runtimeCli')}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => changeRuntimeMode('cli')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  runtimeMode === 'cli'
                    ? 'bg-[var(--color-blue)] text-white'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Terminal className="w-3 h-3" />
                CLI
              </button>
              <button
                onClick={() => changeRuntimeMode('serve')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  runtimeMode === 'serve'
                    ? 'bg-[var(--color-blue)] text-white'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Zap className="w-3 h-3" />
                Serve
              </button>
            </div>
          </div>

          {/* Theme selector */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('settings.theme')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">{t('settings.themeDesc')}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-[var(--color-blue)] text-white'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Moon className="w-3 h-3" />
                {t('settings.dark')}
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-[var(--color-blue)] text-[var(--color-blue)] bg-opacity-10'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Sun className="w-3 h-3" />
                {t('settings.light')}
              </button>
            </div>
          </div>

          {/* Language selector */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('settings.language')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">{t('settings.languageDesc')}</div>
            </div>
            <div className="flex gap-2">
              {(['zh', 'en'] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    locale === l
                      ? 'bg-[var(--color-blue)] text-white'
                      : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {LOCALE_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tasks directory */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          {t('settings.data')}
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <FolderOpen className="w-5 h-5 text-[var(--color-text-muted)]" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--color-text)] flex items-center gap-2">
                {t('settings.tasksDirectory')}
                {dirInfo?.overridden && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-blue)]/15 text-[var(--color-blue)]">
                    {t('settings.tasksDirModified')}
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--color-text-dim)]">
                {t('settings.tasksDirectoryDesc')}
              </div>
            </div>
            <button
              onClick={() => void pickTasksDir()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium shrink-0
                         bg-[var(--color-hover)] text-[var(--color-text-muted)]
                         hover:text-[var(--color-text)] transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t('settings.tasksDirModify')}
            </button>
            {dirInfo?.overridden && (
              <button
                onClick={() => void applyTasksDir(dirInfo.defaultDir, true)}
                disabled={dirBusy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium shrink-0
                           bg-[var(--color-hover)] text-[var(--color-text-muted)]
                           hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                {t('settings.tasksDirReset')}
              </button>
            )}
          </div>
          <div className="bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] font-mono break-all">
            {dirInfo?.current ?? dataDir}
          </div>

          {/* Confirm picked directory (with optional migration) */}
          {pickedDir && (
            <div className="mt-3 border border-[var(--color-blue)]/40 bg-[var(--color-blue)]/5 rounded-lg p-3 space-y-2">
              <div className="text-xs text-[var(--color-text-muted)]">
                {t('settings.tasksDirNew')}:
                <span className="ml-1 font-mono text-[var(--color-text)] break-all">{pickedDir}</span>
              </div>
              <label className="flex items-start gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={migrate}
                  onChange={(e) => setMigrate(e.target.checked)}
                  className="accent-[var(--color-blue)] mt-0.5"
                />
                <span>
                  {t('settings.tasksDirMigrate')}
                  <span className="block text-[var(--color-text-dim)] mt-0.5">{t('settings.tasksDirMigrateHint')}</span>
                </span>
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPickedDir(null)}
                  className="px-3 py-1 rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors"
                >
                  {t('settings.tasksDirCancel')}
                </button>
                <button
                  onClick={() => void applyTasksDir(pickedDir, migrate)}
                  disabled={dirBusy}
                  className="px-3 py-1 rounded-lg text-xs font-medium bg-[var(--color-blue)] text-white
                             hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {t('settings.tasksDirConfirm')}
                </button>
              </div>
            </div>
          )}

          {/* Saved - restart hint */}
          {dirSaved && (
            <div className="mt-3 flex items-center gap-2 border border-[var(--color-green)]/40 bg-[var(--color-green)]/10 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 text-[var(--color-green)] shrink-0" />
              <span className="text-xs text-[var(--color-text)] flex-1">{t('settings.tasksDirSaved')}</span>
              <button
                onClick={() => void window.api.restartApp()}
                className="px-3 py-1 rounded-lg text-xs font-medium bg-[var(--color-green)] text-[var(--color-bg)]
                           hover:opacity-90 transition-opacity shrink-0"
              >
                {t('settings.tasksDirRestart')}
              </button>
            </div>
          )}

          {dirError && (
            <div className="mt-3 flex items-start gap-2 text-xs text-[var(--color-red)] bg-[var(--color-red)]/10 rounded-lg px-3 py-2 break-all">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {dirError}
            </div>
          )}
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section>
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          {t('settings.shortcuts')}
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          {[
            { keys: ['Ctrl', 'N'], action: t('settings.shortcutCreate') },
            { keys: ['Ctrl', 'R'], action: t('settings.shortcutRun') },
            { keys: ['Ctrl', 'L'], action: t('settings.shortcutSearch') },
            { keys: ['Esc'], action: t('settings.shortcutBack') },
          ].map(({ keys, action }) => (
            <div key={action} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-[var(--color-text)]">{action}</span>
              <div className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-1.5 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px] font-mono text-[var(--color-text-muted)]"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
