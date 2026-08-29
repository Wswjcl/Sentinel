// Visual size-comparison strip for the app icon (1024 / 64 / 32).
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(root, 'packages', 'desktop', 'resources', 'icon.svg'))
const sizes = [256, 64, 32]
const bufs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()))
const totalW = sizes.reduce((a, b) => a + b + 20, 0)
const composite = []
let x = 0
for (let i = 0; i < sizes.length; i++) {
  composite.push({ input: bufs[i], left: x, top: 0 })
  x += sizes[i] + 20
}
const out = join(tmpdir(), 'icon-preview.png')
await sharp({ create: { width: totalW, height: 256, channels: 4, background: { r: 42, g: 45, b: 50, alpha: 1 } } })
  .composite(composite).png().toFile(out)
console.log(out)
