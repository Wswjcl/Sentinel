import { useState, useCallback } from 'react'
import type { TaskInfo } from '@sentinel/core'
import { I18nProvider } from './hooks/useI18n'
import { ThemeProvider } from './hooks/useTheme'
import { useI18n } from './hooks/useI18n'
import MainLayout from './components/layout/MainLayout'
import TaskList from './components/tasks/TaskList'
import TaskDetail from './components/tasks/TaskDetail'
import SchedulerPanel from './components/scheduler/SchedulerPanel'
import SettingsPanel from './components/settings/SettingsPanel'
import './i18n'

type View = 'tasks' | 'scheduler' | 'settings'

function AppContent() {
  const [view, setView] = useState<View>('tasks')
  const [selectedTask, setSelectedTask] = useState<TaskInfo | null>(null)
  const { t } = useI18n()

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
              <h1 className="text-xl font-semibold text-[var(--color-text-bright)]">{t('app.workspaces')}</h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                {t('app.workspacesDesc')}
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

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </I18nProvider>
  )
}
