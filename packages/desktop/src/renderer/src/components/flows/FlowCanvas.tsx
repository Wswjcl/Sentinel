import { useEffect, useRef, useState } from 'react'
import type { FlowConfig, FlowNodeStatus } from '@sentinel/core'
import { edgeTarget, edgeCondition } from '../../lib/flow-edges'

interface FlowCanvasProps {
  config: FlowConfig
  /** Live node statuses from the active run (colors the graph) */
  statuses?: Record<string, FlowNodeStatus>
  selectedNode?: string | null
  onSelectNode?: (name: string) => void
  /** Persist a node's canvas position (called on drag release) */
  onNodePosition?: (name: string, position: { x: number; y: number }) => void
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

/** Layered DAG layout for nodes without an explicit position:
 *  level = longest distance from a root node. */
function layoutNodes(config: FlowConfig): Layout {
  const nodes = config.nodes ?? {}
  const levels: Record<string, number> = {}
  const visiting = new Set<string>()

  const compute = (name: string): number => {
    if (levels[name] !== undefined) return levels[name]
    if (visiting.has(name)) return 0 // cycle guard for mid-edit states
    visiting.add(name)
    const needs = (nodes[name]?.needs ?? []).map(edgeTarget)
    const level = needs.length === 0 ? 0 : Math.max(...needs.map(compute)) + 1
    visiting.delete(name)
    levels[name] = level
    return level
  }
  for (const name of Object.keys(nodes)) compute(name)

  const byLevel = new Map<number, string[]>()
  for (const name of Object.keys(nodes)) {
    if (nodes[name].position) continue // placed manually - keep position
    const level = levels[name] ?? 0
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level)!.push(name)
  }

  const pos: Record<string, Pos> = {}
  for (const name of Object.keys(nodes)) {
    if (nodes[name].position) pos[name] = { ...nodes[name].position! }
  }
  for (const [level, names] of byLevel) {
    names.forEach((name, i) => {
      pos[name] = { x: MARGIN + level * (NODE_W + GAP_X), y: MARGIN + i * (NODE_H + GAP_Y) }
    })
  }

  const all = Object.values(pos)
  const width = Math.max(MARGIN * 2 + NODE_W, ...all.map((p) => p.x + NODE_W + MARGIN))
  const height = Math.max(MARGIN * 2 + NODE_H, ...all.map((p) => p.y + NODE_H + MARGIN))
  return { pos, width, height }
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

function edgeStyle(need: string | { node: string; on?: string }): { stroke: string; dash?: string } {
  const on = edgeCondition(need as never)
  if (on === 'failure') return { stroke: 'var(--color-red)', dash: '6 4' }
  if (on === 'finished') return { stroke: 'var(--color-text-dim)', dash: '2 4' }
  return { stroke: 'var(--color-text-dim)' }
}

interface DragState {
  name: string
  startX: number
  startY: number
  originX: number
  originY: number
}

export default function FlowCanvas({ config, statuses, selectedNode, onSelectNode, onNodePosition }: FlowCanvasProps) {
  const nodes = config.nodes ?? {}
  const { pos, width, height } = layoutNodes(config)
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dragPos, setDragPos] = useState<{ name: string; x: number; y: number } | null>(null)

  const toSvgPoint = (clientX: number, clientY: number): Pos => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent): void => {
      const p = toSvgPoint(e.clientX, e.clientY)
      setDragPos({
        name: drag.name,
        x: Math.max(0, drag.originX + p.x - drag.startX),
        y: Math.max(0, drag.originY + p.y - drag.startY),
      })
    }
    const onUp = (e: MouseEvent): void => {
      const p = toSvgPoint(e.clientX, e.clientY)
      const moved =
        Math.abs(p.x - drag.startX) + Math.abs(p.y - drag.startY) > 4
      if (moved) {
        onNodePosition?.(drag.name, {
          x: Math.max(0, Math.round(drag.originX + p.x - drag.startX)),
          y: Math.max(0, Math.round(drag.originY + p.y - drag.startY)),
        })
      } else {
        onSelectNode?.(drag.name) // treat as a click
      }
      setDrag(null)
      setDragPos(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  if (Object.keys(nodes).length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-[var(--color-text-dim)] border border-dashed border-[var(--color-border)] rounded-xl">
        <span>no nodes</span>
      </div>
    )
  }

  const posOf = (name: string): Pos =>
    dragPos?.name === name ? { x: dragPos.x, y: dragPos.y } : pos[name]

  return (
    <div className="overflow-auto border border-[var(--color-border)] rounded-xl bg-[var(--color-hover)]/30">
      <svg ref={svgRef} width={Math.max(width, 300)} height={Math.max(height, 140)} className="block">
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
          <marker
            id="flow-arrow-failure"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-red)" />
          </marker>
        </defs>

        {/* Edges */}
        {Object.entries(nodes).flatMap(([name, node]) =>
          (node.needs ?? []).map((need) => {
            const dep = edgeTarget(need)
            const from = posOf(dep)
            const to = posOf(name)
            if (!from || !to) return null
            const style = edgeStyle(need)
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
                stroke={style.stroke}
                strokeWidth="1.5"
                strokeDasharray={style.dash}
                markerEnd={style.dash ? 'url(#flow-arrow-failure)' : 'url(#flow-arrow)'}
                opacity="0.75"
              />
            )
          }),
        )}

        {/* Nodes */}
        {Object.entries(nodes).map(([name, node]) => {
          const p = posOf(name)
          if (!p) return null
          const live = statuses?.[name]
          const stroke = live ? statusColor(live) : typeColor(node.type)
          const isSelected = selectedNode === name
          return (
            <g
              key={name}
              onMouseDown={(e) => {
                e.preventDefault()
                const pt = toSvgPoint(e.clientX, e.clientY)
                setDrag({ name, startX: pt.x, startY: pt.y, originX: p.x, originY: p.y })
              }}
              className="cursor-grab active:cursor-grabbing"
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
