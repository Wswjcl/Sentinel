import { useEffect, useState, useCallback } from 'react'
import type { TaskInfo } from '@sentinel/core'

export function useTasks() {
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.getTasks()
      setTasks(list)
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()

    // Subscribe to real-time updates
    const unsub = window.api.onTaskUpdate(() => {
      refresh()
    })

    return unsub
  }, [refresh])

  return { tasks, loading, refresh }
}
