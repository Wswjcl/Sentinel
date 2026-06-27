import { Minus, Square, X, Sun, Moon } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'

export default function TitleBar() {
  const { theme, toggle } = useTheme()

  return (
    <div
      className="h-[40px] flex items-center justify-between bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm text-[var(--color-text-muted)]">Sentinel AI Scheduler</span>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Theme toggle */}
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-[var(--color-hover)] rounded transition-colors"
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
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
