import { useState, useCallback } from 'react'
import type { TaskInfo } from '@wwc/core'
import MainLayout from './components/layout/MainLayout'
import TaskDetail from './components/tasks/TaskDetail'

type View = 'tasks' | 'scheduler' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('tasks')
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null)

  const handleBack = useCallback(() => {
    setSelectedTask(null)
  }, [])

  return (
    <MainLayout
      currentView={view}
      onViewChange={(v) => { setView(v); setSelectedTask(null) }}
    >
      {view === 'tasks' && !selectedTask && (
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">Workspaces</h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Each workspace = one directory = one task with its own .opencode/ config
              </p>
            </div>
          </div>
          <TaskList onSelect={setSelectedTask} />
        </div>
      )}
      {view === 'tasks' && selectedTask && (
        <TaskDetail task={selectedTask} onBack={handleBack} />
      )}
      {view === 'scheduler' && (
        <SchedulerPlaceholder />
      )}
      {view === 'settings' && (
        <SettingsPlaceholder />
      )}
    </MainLayout>
  )
}

// Temporary placeholders — will be replaced in commit 5
function SchedulerPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-[var(--color-text-bright)] mb-4">Scheduler</h1>
      <p className="text-[var(--color-text-muted)]">Scheduler panel coming soon...</p>
    </div>
  )
}

function SettingsPlaceholder() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-[var(--color-text-bright)] mb-4">Settings</h1>
      <p className="text-[var(--color-text-muted)]">Settings panel coming soon...</p>
    </div>
  )
}

// Import TaskList lazily to avoid circular dep — will be in separate file
import TaskList from './components/tasks/TaskList'
