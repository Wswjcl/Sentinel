import { useState, useEffect } from 'react'

// Module-level cache shared by every consumer: the list rarely changes
// and the IPC shells out to `opencode models`.
let cache: string[] | null = null
let inflight: Promise<string[]> | null = null

async function loadModels(): Promise<string[]> {
  if (cache) return cache
  if (!inflight) {
    inflight = window.api
      .getModelList()
      .then((r) => {
        cache = r.models
        return r.models
      })
      .catch(() => {
        inflight = null
        return []
      })
  }
  return inflight
}

export interface ModelOption {
  value: string
  free: boolean
}

/** Model options for autocomplete inputs: local `opencode models` output,
 *  free (OpenCode Zen) models first. */
export function useModelOptions(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>([])
  useEffect(() => {
    let alive = true
    void loadModels().then((list) => {
      if (!alive) return
      const opts = list.map((value) => ({
        value,
        free: value.startsWith('opencode/'),
      }))
      opts.sort((a, b) => Number(b.free) - Number(a.free))
      setModels(opts)
    })
    return () => {
      alive = false
    }
  }, [])
  return models
}
