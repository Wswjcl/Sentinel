// Regenerate the app icons from resources/icon.svg (source of truth):
//   icon.png  1024x1024  (window icon + extraResources)
//   tray.png    32x32    (system tray)
//   icon.ico    16..256  (Windows executable icon, via electron-builder)
// Usage: node scripts/gen-icons.mjs   (requires the desktop devDeps sharp + png-to-ico)
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const res = join(root, 'packages', 'desktop', 'resources')

const svg = await readFile(join(res, 'icon.svg'))

async function renderPng(size) {
  return sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
}

await writeFile(join(res, 'icon.png'), await renderPng(1024))
await writeFile(join(res, 'tray.png'), await renderPng(32))

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const ico = await pngToIco(await Promise.all(icoSizes.map(renderPng)))
await writeFile(join(res, 'icon.ico'), ico)

console.log(`icons regenerated from icon.svg (ico: ${icoSizes.join('/')})`)
