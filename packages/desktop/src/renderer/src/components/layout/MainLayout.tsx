import type { ReactNode } from 'react'
import Sidebar from './Sidebar'

interface MainLayoutProps {
  currentView: string
  onViewChange: (view: 'tasks' | 'scheduler' | 'settings') => void
  children: ReactNode
}

export default function MainLayout({ currentView, onViewChange, children }: MainLayoutProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar currentView={currentView} onViewChange={onViewChange} />

      {/* Main content area — below the title bar overlay */}
      <main className="flex-1 overflow-y-auto pt-[40px]">
        {children}
      </main>
    </div>
  )
}
