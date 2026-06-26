import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import { useScheduler } from '../../hooks/useScheduler'

interface LogEntry {
  level: string
  msg: string
  ts?: number
}

export default function SchedulerPanel() {
  const { status, start, stop } = useScheduler()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Subscribe to scheduler logs
  useEffect(() => {
    const unsub = window.api.onSchedulerLog((data) => {
      setLogs((prev) => [...prev.slice(-500), data]) // Keep last 500 entries
    })
    return unsub
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleToggle = useCallback(async () => {
    try {
      if (status.running) {
        await stop()
      } else {
        await start()
      }
    } catch (err) {
      console.error('Scheduler toggle failed:', err)
    }
  }, [status.running, start, stop])

  const handleClearLogs = useCallback(() => {
    setLogs([])
  }, [])

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">Scheduler</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Manage the task scheduler and monitor real-time activity
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            status.running
              ? 'bg-[var(--color-red)] text-white hover:opacity-90'
              : 'bg-[var(--color-green)] text-[var(--color-bg)] hover:opacity-90'
          }`}
        >
          {status.running ? (
            <>
              <Square className="w-3.5 h-3.5" />
              Stop Scheduler
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Start Scheduler
            </>
          )}
        </button>
      </div>

      {/* Status card */}
      <div className="shrink-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              status.running
                ? 'bg-[var(--color-green)] shadow-[0_0_8px_var(--color-green)] animate-pulse-dot'
                : 'bg-[var(--color-text-dim)]'
            }`}
          />
          <div>
            <div className="text-sm font-medium text-[var(--color-text-bright)]">
              {status.running ? 'Scheduler is running' : 'Scheduler is stopped'}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {status.running
                ? 'Tasks are being executed according to their schedules'
                : 'Click "Start Scheduler" to begin processing tasks'}
            </div>
          </div>
        </div>
      </div>

      {/* Log viewer */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            Live Log
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-dim)]">
              {logs.length} entr{logs.length !== 1 ? 'ies' : 'y'}
            </span>
            <button
              onClick={handleClearLogs}
              className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-dim)] transition-colors"
              title="Clear logs"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-y-auto p-3 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <div className="text-[var(--color-text-dim)]">
              {status.running ? 'Waiting for scheduler events...' : 'Start the scheduler to see logs'}
            </div>
          ) : (
            logs.map((entry, i) => (
              <LogLine key={i} entry={entry} />
            ))
          )}
        </div>
        {!autoScroll && logs.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (logContainerRef.current) {
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
              }
            }}
            className="self-center mt-2 px-3 py-1 text-xs bg-[var(--color-hover)] border border-[var(--color-border)]
                       rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>
    </div>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = entry.ts
    ? new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''

  const levelColor = {
    info: 'text-[var(--color-blue)]',
    warn: 'text-[var(--color-yellow)]',
    error: 'text-[var(--color-red)]',
    debug: 'text-[var(--color-text-dim)]',
  }[entry.level] ?? 'text-[var(--color-text)]'

  return (
    <div className="flex gap-2 leading-5">
      {time && <span className="text-[var(--color-text-dim)] shrink-0">{time}</span>}
      <span className={`${levelColor} shrink-0 uppercase w-12`}>{entry.level}</span>
      <span className="text-[var(--color-text)] break-all">{entry.msg}</span>
    </div>
  )
}
