// One-shot extractor: pulls compact provider presets out of cc-switch's
// transpiled opencodeProviderPresets.js and emits a TS data file for the
// Sentinel renderer. Run from the repo root after transpiling:
//   npx tsc <cc-switch>/src/config/opencodeProviderPresets.ts --outDir <tmp> ...
import { writeFile } from 'node:fs/promises'

const mod = await import(process.argv[2])
const presets = mod.opencodeProviderPresets

const stripReferral = (url) => {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return undefined
  }
}

const slug = (name) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const seen = new Set()
const out = []
for (const p of presets) {
  const baseUrl = p.settingsConfig?.options?.baseURL
  const models = Object.keys(p.settingsConfig?.models ?? {})
  if (typeof baseUrl !== 'string' || models.length === 0) continue
  let id = slug(p.name)
  while (seen.has(id)) id += '-2'
  seen.add(id)
  out.push({
    id,
    name: p.name,
    baseUrl,
    models,
    websiteUrl: stripReferral(p.websiteUrl),
    apiKeyUrl: stripReferral(p.apiKeyUrl),
    official: p.isOfficial === true || p.category === 'cn_official' || undefined,
  })
}

const body = `// Provider presets for the profile editor. Data extracted from
// cc-switch (https://github.com/farion1231/cc-switch, MIT) - ported as
// data, referral/tracking parameters stripped. Regenerate with
// scripts/extract-presets.mjs when upstream updates.
export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  models: string[]
  websiteUrl?: string
  apiKeyUrl?: string
  official?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = ${JSON.stringify(out, null, 2)}
`
await writeFile(new URL('../packages/desktop/src/renderer/src/lib/provider-presets.ts', import.meta.url), body)
console.log(`wrote ${out.length} presets`)
