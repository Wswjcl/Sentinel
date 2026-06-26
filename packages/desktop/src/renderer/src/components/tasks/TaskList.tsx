import { useState } from 'react'
import type { TaskInfo } from '@wwc/core'
import { useTasks } from '../../hooks/useTasks'
import TaskCard from './TaskCard'
import CreateTaskDialog from './CreateTaskDialog'

interface TaskListProps {
  onSelect: (task: TaskInfo) => void
}

export default function TaskList({ onSelect }: TaskListProps) {
  const { tasks, loading, refresh } = useTasks()
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = tasks.filter((t) =>
    t.config.name.toLowerCase().includes(search.toLowerCase()) ||
    t.config.description?.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg
                       px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-dim)]
                       focus:outline-none focus:border-[var(--color-blue)] transition-colors"
          />
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-1.5 bg-[var(--color-green)] text-[var(--color-bg)] rounded-lg text-sm font-medium
                     hover:opacity-90 transition-opacity shrink-0"
        >
          + New Task
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)] text-sm">
          Loading tasks...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-dim)]">
          <p className="text-sm mb-1">
            {tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
          </p>
          {tasks.length === 0 && (
            <p className="text-xs">Create your first task to get started</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map((task) => (
            <TaskCard
              key={task.config.name}
              task={task}
              onClick={() => onSelect(task)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateTaskDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            refresh()
          }}
        />
      )}
    </>
  )
}
