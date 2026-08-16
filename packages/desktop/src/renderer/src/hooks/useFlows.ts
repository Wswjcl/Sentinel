import { useEffect, useState, useCallback } from 'react'
import type { FlowInfo } from '../../../shared/ipc-types'

export function useFlows() {
  const [flows, setFlows] = useState<FlowInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.getFlows()
      setFlows(list)
    } catch (err) {
      console.error('Failed to load flows:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Refresh the list when a flow finishes; live node-level updates
    // are handled by the detail view for canvas coloring.
    const unsub = window.api.onFlowUpdate((data) => {
      if (data.event === 'completed') refresh()
    })
    return unsub
  }, [refresh])

  return { flows, loading, refresh }
}
