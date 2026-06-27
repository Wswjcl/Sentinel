import type { TaskInfo, TaskStatus } from '@sentinel/core'
import { useI18n } from '../../hooks/useI18n'

interface TaskCardProps {
  task: TaskInfo
  onClick: () => void
}

const statusColor: Record<TaskStatus, string> = {
  pending:   'text-[var(--color-text-muted)]',
  scheduled: 'text-[var(--color-blue)]',
  running:   'text-[var(--color-green)]',
  success:   'text-[var(--color-green)]',
  failed:    'text-[var(--color-red)]',
  paused:    'text-[var(--color-yellow)]',
  archived:  'text-[var(--color-text-dim)]',
}

const statusBg: Record<TaskStatus, string> = {
  pending:   'bg-[var(--color-text-dim)]',
  scheduled: 'bg-[var(--color-blue)]',
  running:   'bg-[var(--color-green)]',
  success:   'bg-[var(--color-green)]',
  failed:    'bg-[var(--color-red)]',
  paused:    'bg-[var(--color-yellow)]',
  archived:  'bg-[var(--color-text-dim)]',
}

function formatRelativeTime(iso: string | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const absDiff = Math.abs(diff)
  const prefix = diff > 0 ? '' : t('task.in')

  if (absDiff < 60_000) return diff > 0 ? t('task.justNow') : t('task.soon')
  if (absDiff < 3_600_000) return `${prefix}${Math.floor(absDiff / 60_000)}m`
  if (absDiff < 86_400_000) return `${prefix}${Math.floor(absDiff / 3_600_000)}h`
  return `${prefix}${Math.floor(absDiff / 86_400_000)}d`
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const { config, status, lastRun, nextRun, runCount } = task
  const { t } = useI18n()

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
          <div className={`w-1.5 h-1.5 rounded-full ${statusBg[status]} ${status === 'running' ? 'animate-pulse-dot' : ''}`} />
          <span className={`text-xs font-medium ${statusColor[status]}`}>{t(`status.${status}`)}</span>
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
        <span title={t('task.schedule')}>
          {config.schedule.type}: {config.schedule.expr}
        </span>
        <span title={t('task.runCountTitle')}>
          {t('task.runCount', { count: runCount })}
        </span>
        {lastRun && (
          <span title={t('task.lastRunTitle')}>
            {t('task.lastRun')} {formatRelativeTime(lastRun, t)}
          </span>
        )}
        {nextRun && status !== 'running' && (
          <span title={t('task.nextRunTitle')}>
            {t('task.nextRun')} {formatRelativeTime(nextRun, t)}
          </span>
        )}
      </div>
    </button>
  )
}
