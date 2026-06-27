import { useState, useEffect } from 'react'
import { FolderOpen, Sun, Moon } from 'lucide-react'
import { useTheme, type Theme } from '../../hooks/useTheme'
import { useI18n, type Locale, LOCALE_LABELS } from '../../hooks/useI18n'

export default function SettingsPanel() {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const [version, setVersion] = useState('')

  useEffect(() => {
    setVersion('1.0.0')
  }, [])

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
            <div>
              <div className="text-sm text-[var(--color-text)]">{t('settings.tasksDirectory')}</div>
              <div className="text-xs text-[var(--color-text-dim)]">
                {t('settings.tasksDirectoryDesc')}
              </div>
            </div>
          </div>
          <div className="bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] font-mono break-all">
            {t('settings.tasksDirectoryInfo')}
          </div>
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
