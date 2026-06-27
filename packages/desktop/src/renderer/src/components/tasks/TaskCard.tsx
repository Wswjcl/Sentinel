import type { TaskInfo, TaskStatus } from '@sentinel/core'

interface TaskCardProps {
  task: TaskInfo
  onClick: () => void
}

const statusConfig: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--color-text-dim)]' },
  scheduled: { label: 'Scheduled', color: 'text-[var(--color-blue)]',        bg: 'bg-[var(--color-blue)]' },
  running:   { label: 'Running',   color: 'text-[var(--color-green)]',       bg: 'bg-[var(--color-green)]' },
  success:   { label: 'Success',   color: 'text-[var(--color-green)]',       bg: 'bg-[var(--color-green)]' },
  failed:    { label: 'Failed',    color: 'text-[var(--color-red)]',         bg: 'bg-[var(--color-red)]' },
  paused:    { label: 'Paused',    color: 'text-[var(--color-yellow)]',      bg: 'bg-[var(--color-yellow)]' },
  archived:  { label: 'Archived',  color: 'text-[var(--color-text-dim)]',    bg: 'bg-[var(--color-text-dim)]' },
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const absDiff = Math.abs(diff)
  const prefix = diff > 0 ? '' : 'in '

  if (absDiff < 60_000) return diff > 0 ? 'just now' : 'soon'
  if (absDiff < 3_600_000) return `${prefix}${Math.floor(absDiff / 60_000)}m`
  if (absDiff < 86_400_000) return `${prefix}${Math.floor(absDiff / 3_600_000)}h`
  return `${prefix}${Math.floor(absDiff / 86_400_000)}d`
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const { config, status, lastRun, nextRun, runCount } = task
  const sc = statusConfig[status] ?? statusConfig.pending

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4
                 hover:border-[var(--color-text-dim)] transition-all group cursor-pointer"
    >
      {/* Header: name + status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-[var(--color-text-bright)] truncate">
            {config.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${sc.bg} ${status === 'running' ? 'animate-pulse-dot' : ''}`} />
          <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
        </div>
      </div>

      {/* Description */}
      {config.description && (
        <p className="text-xs text-[var(--color-text-muted)] mb-3 line-clamp-2">
          {config.description}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-4 text-[10px] text-[var(--color-text-dim)]">
        <span title="Schedule">
          {config.schedule.type}: {config.schedule.expr}
        </span>
        <span title="Run count">
          {runCount} run{runCount !== 1 ? 's' : ''}
        </span>
        {lastRun && (
          <span title="Last run">
            last {formatRelativeTime(lastRun)}
          </span>
        )}
        {nextRun && status !== 'running' && (
          <span title="Next run">
            next {formatRelativeTime(nextRun)}
          </span>
        )}
      </div>
    </button>
  )
}
