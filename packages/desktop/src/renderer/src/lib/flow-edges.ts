/**
 * Renderer-safe copies of the core edge helpers. The renderer must not
 * value-import from @sentinel/core (it bundles node:fs etc. for the
 * main process); type-only imports are fine.
 */
import type { FlowEdge, FlowEdgeCondition } from '@sentinel/core'

export function edgeTarget(need: string | FlowEdge): string {
  return typeof need === 'string' ? need : need.node
}

export function edgeCondition(need: string | FlowEdge): FlowEdgeCondition {
  return typeof need === 'string' ? 'success' : (need.on ?? 'success')
}
