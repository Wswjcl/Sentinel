import { useEffect, useState, useCallback } from 'react'

interface SchedulerState {
  running: boolean
}

export function useScheduler() {
  const [status, setStatus] = useState<SchedulerState>({ running: false })

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.getSchedulerStatus()
      setStatus(s)
    } catch (err) {
      console.error('Failed to get scheduler status:', err)
    }
  }, [])

  useEffect(() => {
    refresh()

    // Subscribe to real-time status changes
    const unsub = window.api.onSchedulerStatus((data) => {
      setStatus(data)
    })

    return unsub
  }, [refresh])

  const start = useCallback(async () => {
    await window.api.startScheduler()
    await refresh()
  }, [refresh])

  const stop = useCallback(async () => {
    await window.api.stopScheduler()
    await refresh()
  }, [refresh])

  return { status, start, stop, refresh }
}
