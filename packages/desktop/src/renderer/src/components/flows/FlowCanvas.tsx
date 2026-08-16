import type { FlowConfig, FlowNodeStatus } from '@sentinel/core'

interface FlowCanvasProps {
  config: FlowConfig
  /** Live node statuses from the active run (colors the graph) */
  statuses?: Record<string, FlowNodeStatus>
  selectedNode?: string | null
  onSelectNode?: (name: string) => void
}

const NODE_W = 150
const NODE_H = 48
const GAP_X = 70
const GAP_Y = 26
const MARGIN = 24

interface Pos {
  x: number
  y: number
}

interface Layout {
  pos: Record<string, Pos>
  width: number
  height: number
}

/** Layered DAG layout: level = longest distance from a root node. */
function layoutNodes(config: FlowConfig): Layout {
  const nodes = config.nodes ?? {}
  const levels: Record<string, number> = {}
  const visiting = new Set<string>()

  const compute = (name: string): number => {
    if (levels[name] !== undefined) return levels[name]
    if (visiting.has(name)) return 0 // cycle guard for mid-edit states
    visiting.add(name)
    const needs = nodes[name]?.needs ?? []
    const level = needs.length === 0 ? 0 : Math.max(...needs.map(compute)) + 1
    visiting.delete(name)
    levels[name] = level
    return level
  }
  for (const name of Object.keys(nodes)) compute(name)

  const byLevel = new Map<number, string[]>()
  for (const [name, level] of Object.entries(levels)) {
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level)!.push(name)
  }

  const pos: Record<string, Pos> = {}
  for (const [level, names] of byLevel) {
    names.forEach((name, i) => {
      pos[name] = { x: MARGIN + level * (NODE_W + GAP_X), y: MARGIN + i * (NODE_H + GAP_Y) }
    })
  }

  const maxLevel = Math.max(0, ...byLevel.keys())
  const maxRows = Math.max(1, ...[...byLevel.values()].map((v) => v.length))
  return {
    pos,
    width: MARGIN * 2 + (maxLevel + 1) * NODE_W + maxLevel * GAP_X,
    height: MARGIN * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y,
  }
}

function statusColor(status?: FlowNodeStatus): string {
  switch (status) {
    case 'running': return 'var(--color-blue)'
    case 'success': return 'var(--color-green)'
    case 'failed': return 'var(--color-red)'
    case 'skipped': return 'var(--color-text-dim)'
    default: return 'var(--color-border)'
  }
}

function typeColor(type: string): string {
  switch (type) {
    case 'ai': return 'var(--color-blue)'
    case 'script': return 'var(--color-green)'
    case 'manual': return 'var(--color-orange, #f59e0b)'
    default: return 'var(--color-border)'
  }
}

export default function FlowCanvas({ config, statuses, selectedNode, onSelectNode }: FlowCanvasProps) {
  const nodes = config.nodes ?? {}
  const { pos, width, height } = layoutNodes(config)

  if (Object.keys(nodes).length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[var(--color-text-dim)] border border-dashed border-[var(--color-border)] rounded-xl">
        {/* eslint-disable-next-line */}
        <span>no nodes</span>
      </div>
    )
  }

  return (
    <div className="overflow-auto border border-[var(--color-border)] rounded-xl bg-[var(--color-hover)]/30">
      <svg width={width} height={height} className="block">
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-dim)" />
          </marker>
        </defs>

        {/* Edges */}
        {Object.entries(nodes).flatMap(([name, node]) =>
          (node.needs ?? []).map((dep) => {
            const from = pos[dep]
            const to = pos[name]
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            const dx = Math.max(30, (x2 - x1) / 2)
            return (
              <path
                key={`${dep}->${name}`}
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--color-text-dim)"
                strokeWidth="1.5"
                markerEnd="url(#flow-arrow)"
                opacity="0.7"
              />
            )
          }),
        )}

        {/* Nodes */}
        {Object.entries(nodes).map(([name, node]) => {
          const p = pos[name]
          if (!p) return null
          const live = statuses?.[name]
          const stroke = live ? statusColor(live) : typeColor(node.type)
          const isSelected = selectedNode === name
          return (
            <g
              key={name}
              onClick={() => onSelectNode?.(name)}
              className="cursor-pointer"
            >
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx="10"
                fill="var(--color-card)"
                stroke={stroke}
                strokeWidth={isSelected || live === 'running' ? 2.5 : 1.5}
              />
              <text
                x={p.x + 12}
                y={p.y + 20}
                fontSize="13"
                fontWeight="600"
                fill="var(--color-text)"
                style={{ userSelect: 'none' }}
              >
                {name.length > 16 ? name.slice(0, 15) + '…' : name}
              </text>
              <text x={p.x + 12} y={p.y + 36} fontSize="11" fill="var(--color-text-dim)" style={{ userSelect: 'none' }}>
                {live ? `${node.type} · ${live}` : node.type}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
