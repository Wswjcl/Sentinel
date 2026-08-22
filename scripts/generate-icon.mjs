// Sentinel app icon generator
// Renders the brand icon (rounded blue square + white shield + blue check)
// at multiple sizes with 4x supersampled anti-aliasing, then writes:
//   packages/desktop/resources/icon.png  (1024x1024, window + linux/mac packaging)
//   packages/desktop/resources/icon.ico  (16..256, Windows packaging)
//   packages/desktop/resources/tray.png  (32x32, system tray)
//
// Run: node scripts/generate-icon.mjs
// Pure Node (zlib + manual PNG/ICO encoding), no dependencies.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES_DIR = join(ROOT, 'packages', 'desktop', 'resources')

// ─── Palette ────────────────────────────────────────────────
const BG_TOP = [0x3b, 0x82, 0xf6] // brand blue #3B82F6
const BG_BOTTOM = [0x25, 0x63, 0xeb] // deeper blue #2563EB
const SHIELD = [0xff, 0xff, 0xff] // white
const CHECK = [0x3b, 0x82, 0xf6] // brand blue

// ─── Normalized geometry (0..1) ─────────────────────────────
const CORNER_R = 0.23 // rounded-square corner radius

function inRoundedRect(u, v, r) {
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0)
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0)
  return qx * qx + qy * qy <= r * r
}

// Shield sides as cubic beziers from the top corners down to the bottom point.
const LEFT = { p0: [0.155, 0.235], c1: [0.175, 0.5], c2: [0.335, 0.72], p3: [0.5, 0.855] }
const RIGHT = { p0: [0.845, 0.235], c1: [0.825, 0.5], c2: [0.665, 0.72], p3: [0.5, 0.855] }

function cubic(p, t) {
  const mt = 1 - t
  return [
    mt * mt * mt * p.p0[0] + 3 * mt * mt * t * p.c1[0] + 3 * mt * t * t * p.c2[0] + t * t * t * p.p3[0],
    mt * mt * mt * p.p0[1] + 3 * mt * mt * t * p.c1[1] + 3 * mt * t * t * p.c2[1] + t * t * t * p.p3[1],
  ]
}

// Sample the shield boundary into a closed polygon (down left side, up right
// side, across the top) for ray-cast containment tests.
function shieldPolygon(steps = 48) {
  const poly = []
  for (let i = 0; i <= steps; i++) poly.push(cubic(LEFT, i / steps))
  for (let i = steps; i >= 0; i--) poly.push(cubic(RIGHT, i / steps))
  return poly
}

const SHIELD_POLY = shieldPolygon()

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1]
    const xj = poly[j][0], yj = poly[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// Checkmark polyline + thickness (blue on the white shield).
const CHECK_PTS = [
  [0.355, 0.49],
  [0.455, 0.585],
  [0.645, 0.375],
]
const CHECK_W = 0.085

function onCheck(u, v) {
  const half = CHECK_W / 2
  for (let i = 0; i < CHECK_PTS.length - 1; i++) {
    const [ax, ay] = CHECK_PTS[i]
    const [bx, by] = CHECK_PTS[i + 1]
    if (distToSegment(u, v, ax, ay, bx, by) <= half) return true
  }
  // rounded end caps
  const [a, c] = [CHECK_PTS[0], CHECK_PTS[CHECK_PTS.length - 1]]
  if (Math.hypot(u - a[0], v - a[1]) <= half) return true
  if (Math.hypot(u - c[0], v - c[1]) <= half) return true
  return false
}

// ─── Rendering ──────────────────────────────────────────────
function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

const SS = 4 // supersampling factor for anti-aliasing

function sampleColor(u, v) {
  if (!inRoundedRect(u, v, CORNER_R)) return [0, 0, 0, 0]
  if (onCheck(u, v)) return [...CHECK, 255]
  if (inPolygon(u, v, SHIELD_POLY)) return [...SHIELD, 255]
  const [r, g, b] = lerp(BG_TOP, BG_BOTTOM, Math.min(Math.max(v, 0), 1))
  return [r, g, b, 255]
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const step = 1 / (size * SS)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x * SS + sx + 0.5) / (size * SS)) - step / 2
          const v = ((y * SS + sy + 0.5) / (size * SS)) - step / 2
          const c = sampleColor(u, v)
          r += c[0]; g += c[1]; b += c[2]; a += c[3]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      px[i] = Math.round(r / n)
      px[i + 1] = Math.round(g / n)
      px[i + 2] = Math.round(b / n)
      px[i + 3] = Math.round(a / n)
    }
  }
  return px
}

// ─── PNG encoding ───────────────────────────────────────────
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(px, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0 // filter: none
    px.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── ICO encoding (PNG-compressed entries, Vista+) ──────────
function encodeIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + 16 * count
  for (const { size, png } of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // color count
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

// ─── Main ───────────────────────────────────────────────────
mkdirSync(RES_DIR, { recursive: true })

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoPngs = icoSizes.map((size) => ({ size, png: encodePng(render(size), size) }))

const icon1024 = encodePng(render(1024), 1024)
const tray32 = encodePng(render(32), 32)

writeFileSync(join(RES_DIR, 'icon.png'), icon1024)
writeFileSync(join(RES_DIR, 'icon.ico'), encodeIco(icoPngs))
writeFileSync(join(RES_DIR, 'tray.png'), tray32)

console.log('Generated:')
console.log(`  ${join(RES_DIR, 'icon.png')}  (1024x1024)`)
console.log(`  ${join(RES_DIR, 'icon.ico')}  (${icoSizes.join('/')})`)
console.log(`  ${join(RES_DIR, 'tray.png')}  (32x32)`)
