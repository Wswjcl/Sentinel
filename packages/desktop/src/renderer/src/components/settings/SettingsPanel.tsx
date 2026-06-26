import { useState, useEffect } from 'react'
import { FolderOpen, Sun, Moon } from 'lucide-react'
import { useTheme, type Theme } from '../../hooks/useTheme'

export default function SettingsPanel() {
  const { theme, setTheme } = useTheme()
  const [version, setVersion] = useState('')

  useEffect(() => {
    setVersion('1.0.0')
  }, [])

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-[var(--color-text-bright)] mb-1">Settings</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Configure WWC desktop application preferences
      </p>

      {/* Application info */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          Application
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">Version</div>
              <div className="text-xs text-[var(--color-text-dim)]">Current application version</div>
            </div>
            <span className="text-sm text-[var(--color-text-bright)] font-mono">v{version}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">Runtime</div>
              <div className="text-xs text-[var(--color-text-dim)]">Electron + React</div>
            </div>
            <span className="text-sm text-[var(--color-text-bright)] font-mono">Desktop</span>
          </div>

          {/* Theme selector */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm text-[var(--color-text)]">Theme</div>
              <div className="text-xs text-[var(--color-text-dim)]">Choose your preferred appearance</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-[var(--color-blue)] text-white'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Moon className="w-3 h-3" />
                Dark
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-[var(--color-blue)] text-[var(--color-blue)] bg-opacity-10'
                    : 'bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Sun className="w-3 h-3" />
                Light
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Tasks directory */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          Data
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <FolderOpen className="w-5 h-5 text-[var(--color-text-muted)]" />
            <div>
              <div className="text-sm text-[var(--color-text)]">Tasks Directory</div>
              <div className="text-xs text-[var(--color-text-dim)]">
                All task workspaces are stored here
              </div>
            </div>
          </div>
          <div className="bg-[var(--color-hover)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] font-mono break-all">
            Configured via WWC_TASKS_DIR environment variable or CLI flag
          </div>
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section>
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
          Keyboard Shortcuts
        </h2>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border)]">
          {[
            { keys: ['Ctrl', 'N'], action: 'Create new task' },
            { keys: ['Ctrl', 'R'], action: 'Run selected task' },
            { keys: ['Ctrl', 'L'], action: 'Focus search' },
            { keys: ['Esc'], action: 'Go back / Close dialog' },
          ].map(({ keys, action }) => (
            <div key={action} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-[var(--color-text)]">{action}</span>
              <div className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-1.5 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px] font-mono text-[var(--color-text-muted)]"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
