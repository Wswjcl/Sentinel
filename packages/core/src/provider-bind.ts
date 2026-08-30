import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Provider binding: compile a desktop-managed provider profile into a
 * task workspace's .opencode/opencode.json so the task overrides the
 * global provider (cc-switch territory) - workspace config wins in
 * opencode's resolution order.
 *
 * Merge discipline (the cc-switch lesson, Issue #2681): only the fields
 * we own are touched - `provider.<id>.options.baseURL/apiKey` and
 * `model`. Everything else in the user's config (permissions, mcp,
 * agents...) passes through untouched. A sidecar file records exactly
 * what we wrote so unbind can remove only that.
 */

const OPENCODE_CONFIG = 'opencode.json'
const SIDECAR = '.sentinel-provider.json'

/** What we last wrote, for precise unbind. */
interface BindingSidecar {
  profileId: string
  provider: string
  model: string
  baseURL?: string
}

export interface ProviderBindingInput {
  profileId: string
  /** OpenCode provider id, e.g. "zai-coding-plan". */
  provider: string
  /** Model id within the provider, e.g. "glm-5.2". */
  model: string
  baseUrl?: string
  apiKey?: string
}

/** Atomic JSON write: temp file + rename, so a crash mid-write can
 *  never leave a truncated config behind. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await rename(tmp, path)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Apply (binding) or remove (null) a provider binding in the task
 *  workspace's .opencode/opencode.json. Never throws on malformed
 *  user config except when even mkdir fails. */
export async function applyProviderBinding(
  taskDir: string,
  binding: ProviderBindingInput | null,
): Promise<void> {
  const ocDir = join(taskDir, '.opencode')
  await mkdir(ocDir, { recursive: true })
  const configPath = join(ocDir, OPENCODE_CONFIG)
  const sidecarPath = join(ocDir, SIDECAR)

  const config = (await readJson<Record<string, unknown>>(configPath)) ?? {}
  const sidecar = await readJson<BindingSidecar>(sidecarPath)

  if (binding) {
    // Merge into the provider entry, preserving unknown option keys
    const providers = (config.provider as Record<string, unknown> | undefined) ?? {}
    const entry = (providers[binding.provider] as
      | { options?: Record<string, unknown> }
      | undefined) ?? {}
    const options = { ...(entry.options ?? {}) }
    if (binding.baseUrl !== undefined) options.baseURL = binding.baseUrl
    if (binding.apiKey !== undefined) options.apiKey = binding.apiKey
    providers[binding.provider] = { ...entry, options }
    config.provider = providers
    config.model = `${binding.provider}/${binding.model}`
    await writeJsonAtomic(configPath, config)
    await writeJsonAtomic(sidecarPath, {
      profileId: binding.profileId,
      provider: binding.provider,
      model: binding.model,
      baseURL: binding.baseUrl,
    } satisfies BindingSidecar)
    return
  }

  // Unbind: remove only what the sidecar says we wrote
  if (!sidecar) return
  if (config.model === `${sidecar.provider}/${sidecar.model}`) {
    delete config.model
  }
  const providers = config.provider as Record<string, unknown> | undefined
  const entry = providers?.[sidecar.provider] as
    | { options?: Record<string, unknown> }
    | undefined
  if (entry && providers) {
    const options = { ...entry.options }
    if (sidecar.baseURL !== undefined && options.baseURL === sidecar.baseURL) {
      delete options.baseURL
      delete options.apiKey
    }
    if (Object.keys(options).length === 0) delete entry.options
    if (Object.keys(entry).length === 0) delete providers[sidecar.provider]
    if (Object.keys(providers).length === 0) delete config.provider
  }
  await writeJsonAtomic(configPath, config)
  await rm(sidecarPath, { force: true })
}
