import { useState, useCallback } from 'react'
import type { TaskInfo } from '@wwc/core'
import MainLayout from './components/layout/MainLayout'
import TaskList from './components/tasks/TaskList'
import TaskDetail from './components/tasks/TaskDetail'
import SchedulerPanel from './components/scheduler/SchedulerPanel'
import SettingsPanel from './components/settings/SettingsPanel'

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
      {view === 'scheduler' && <SchedulerPanel />}
      {view === 'settings' && <SettingsPanel />}
    </MainLayout>
  )
}
