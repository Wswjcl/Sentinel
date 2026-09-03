import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import PermissionOverlay from './PermissionOverlay'

interface MainLayoutProps {
  currentView: string
  onViewChange: (view: 'tasks' | 'flows' | 'skills' | 'scheduler' | 'usage' | 'settings') => void
  children: ReactNode
}

export default function MainLayout({ currentView, onViewChange, children }: MainLayoutProps) {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Custom title bar */}
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar currentView={currentView} onViewChange={onViewChange} />

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Global permission approval surface - covers tasks and flows alike */}
      <PermissionOverlay />
    </div>
  )
}
