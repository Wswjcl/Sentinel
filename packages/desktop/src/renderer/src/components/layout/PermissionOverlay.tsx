import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, ShieldX } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import type { PermissionAskData } from '../../../../shared/ipc-types'

interface PendingAsk {
  name: string
  request: PermissionAskData
}

/** A card whose ask already settled (timeout auto-deny) - shown briefly so
 *  the user understands why it disappeared and that clicking came too late. */
interface ExpiredAsk {
  id: string
  name: string
  tool: string
}

/** Global permission approval overlay: the single surface where every
 *  serve-runtime permission ask lands - tasks AND flow AI nodes. Rendered
 *  once in MainLayout, independent of which panel is open, so asks can
 *  never silently time out just because nobody was watching the right tab.
 *  Cards are removed the moment the ask settles, whether by click or by
 *  core's timeout auto-deny. */
export default function PermissionOverlay() {
  const { t } = useI18n()
  const [pending, setPending] = useState<PendingAsk[]>([])
  const [expired, setExpired] = useState<ExpiredAsk[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Mirror of `pending` for event handlers (state updaters must stay pure)
  const pendingRef = useRef<PendingAsk[]>([])

  useEffect(() => {
    const unsubAsk = window.api.onTaskPermission(({ name, request }) => {
      setPending((prev) =>
        prev.some((p) => p.request.id === request.id) ? prev : [...prev, { name, request }],
      )
    })
    // Settled without a click (timeout auto-deny in core) - drop the card
    // and flash an explanatory note instead of leaving a dead button around.
    const unsubResult = window.api.onTaskPermissionResult(({ name, id, response }) => {
      const gone = pendingRef.current.find((p) => p.request.id === id)
      setPending((prev) => prev.filter((p) => p.request.id !== id))
      if (response === 'timeout' && gone) {
        const entry: ExpiredAsk = { id, name: gone.name, tool: gone.request.permission }
        setExpired((ex) => [...ex, entry])
        timers.current.push(
          setTimeout(() => setExpired((ex) => ex.filter((e) => e.id !== entry.id)), 4000),
        )
      }
    })
    return () => {
      unsubAsk()
      unsubResult()
      for (const timer of timers.current) clearTimeout(timer)
    }
  }, [])

  // Keep the ref mirror in sync (render-time assignment of a ref to
  // current state is the standard mirror pattern)
  pendingRef.current = pending

  const respond = async (permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> => {
    setPending((prev) => prev.filter((p) => p.request.id !== permissionId))
    try {
      await window.api.respondTaskPermission(permissionId, response)
    } catch {
      // Already answered elsewhere (e.g. double surface) - ignore
    }
  }

  if (pending.length === 0 && expired.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[90vw]">
      {expired.map((e) => (
        <div
          key={`expired-${e.id}`}
          className="rounded-xl border border-[var(--color-red)] bg-[var(--color-card)] p-3
                     shadow-lg opacity-80 flex items-center gap-2"
        >
          <ShieldX className="w-4 h-4 text-[var(--color-red)] shrink-0" />
          <span className="text-xs text-[var(--color-text-muted)] truncate">
            {t('detail.permissionExpired', { tool: e.tool, name: e.name })}
          </span>
        </div>
      ))}
      {pending.map(({ name, request }) => (
        <div
          key={request.id}
          className="rounded-xl border border-[var(--color-yellow)] bg-[var(--color-card)] p-3
                     shadow-lg"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldAlert className="w-4 h-4 text-[var(--color-yellow)] shrink-0" />
            <span className="text-sm font-medium text-[var(--color-text)] truncate">
              {t('detail.permissionAsk', { tool: request.permission })}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">{name}</p>
          {request.patterns.length > 0 && (
            <pre className="text-xs text-[var(--color-text)] bg-[var(--color-hover)] rounded p-2 mb-2
                           whitespace-pre-wrap break-all max-h-24 overflow-auto font-mono selectable">
              {request.patterns.join('\n')}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void respond(request.id, 'once')}
              className="flex-1 px-2 py-1 rounded text-xs font-medium bg-[var(--color-green)] text-white hover:opacity-90"
            >
              {t('detail.permissionOnce')}
            </button>
            <button
              onClick={() => void respond(request.id, 'always')}
              className="flex-1 px-2 py-1 rounded text-xs font-medium bg-[var(--color-blue)] text-white hover:opacity-90"
            >
              {t('detail.permissionAlways')}
            </button>
            <button
              onClick={() => void respond(request.id, 'reject')}
              className="flex-1 px-2 py-1 rounded text-xs font-medium bg-[var(--color-red)] text-white hover:opacity-90"
            >
              {t('detail.permissionReject')}
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-dim)] mt-1.5">{t('detail.permissionTimeoutHint')}</p>
        </div>
      ))}
    </div>
  )
}
