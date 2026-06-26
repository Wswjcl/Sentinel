import { Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  return (
    <div
      className="h-[40px] flex items-center justify-between bg-[var(--color-bg)] border-b border-[var(--color-border)] px-4 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm text-[var(--color-text-muted)]">WWC AI Scheduler</span>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
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
