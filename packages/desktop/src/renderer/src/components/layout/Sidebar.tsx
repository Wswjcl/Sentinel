import { Clock, Settings, ListTodo, Play } from 'lucide-react'
import { useScheduler } from '../../hooks/useScheduler'

interface SidebarProps {
  currentView: string
  onViewChange: (view: 'tasks' | 'scheduler' | 'settings') => void
}

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const { status } = useScheduler()

  const navItems = [
    { id: 'tasks' as const, label: 'Tasks', icon: ListTodo },
    { id: 'scheduler' as const, label: 'Scheduler', icon: Clock },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-56 bg-[var(--color-card)] border-r border-[var(--color-border)] flex flex-col shrink-0">
      {/* Logo area */}
      <div className="h-[40px] flex items-center px-4 border-b border-[var(--color-border)]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-[var(--color-green)]" />
          <span className="text-sm font-semibold text-[var(--color-text-bright)]">WWC</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onViewChange(id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1 ${
              currentView === id
                ? 'bg-[var(--color-hover)] text-[var(--color-text-bright)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* Scheduler status */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 text-xs">
          <div
            className={`w-2 h-2 rounded-full ${
              status.running
                ? 'bg-[var(--color-green)] shadow-[0_0_6px_var(--color-green)]'
                : 'bg-[var(--color-text-dim)]'
            }`}
          />
          <span className="text-[var(--color-text-muted)]">
            {status.running ? 'Scheduler: Running' : 'Scheduler: Off'}
          </span>
        </div>
      </div>
    </aside>
  )
}
