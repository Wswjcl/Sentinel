import { Minus, Square, X, Sun, Moon, Globe } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useI18n, type Locale } from '../../hooks/useI18n'

export default function TitleBar() {
  const { theme, toggle } = useTheme()
  const { locale, setLocale, t } = useI18n()

  const toggleLocale = () => {
    setLocale(locale === 'zh' ? 'en' : 'zh')
  }

  return (
    <div
      className="h-[40px] flex items-center justify-between bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm text-[var(--color-text-muted)]">{t('app.title')}</span>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Language toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-hover)] rounded transition-colors"
          onClick={toggleLocale}
          title={locale === 'zh' ? t('i18n.switchToEn') : t('i18n.switchToZh')}
        >
          <Globe className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </button>

        {/* Theme toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-hover)] rounded transition-colors"
          onClick={toggle}
          title={theme === 'dark' ? t('theme.switchLight') : t('theme.switchDark')}
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          )}
        </button>

        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

        {/* Window controls */}
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-hover)] rounded transition-colors"
          onClick={() => window.api.minimizeWindow()}
        >
          <Minus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-hover)] rounded transition-colors"
          onClick={() => window.api.maximizeWindow()}
        >
          <Square className="w-3 h-3 text-[var(--color-text-muted)]" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-red)] rounded transition-colors"
          onClick={() => window.api.closeWindow()}
        >
          <X className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </button>
      </div>
    </div>
  )
}
