import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Provider provenance: which provider/model/endpoint a run actually used.
 * Resolved the same way opencode resolves it - the task workspace's
 * .opencode/opencode.json overrides the global config - so a task bound
 * to nothing reports the global (e.g. cc-switch-managed) provider.
 *
 * Secrets are never included: the endpoint is reduced to its origin.
 */

export interface ProviderProvenance {
  /** Provider id, e.g. "zai-coding-plan". */
  provider?: string
  /** Model id within the provider, e.g. "glm-5.2". */
  model?: string
  /** Endpoint origin (protocol + host) - no path, no credentials. */
  endpoint?: string
  /** Which config layer defined the provider/model. */
  source?: 'workspace' | 'global'
}

/** Subset of opencode's config schema that provenance cares about. */
interface OpenCodeConfigFile {
  model?: string
  provider?: Record<string, { options?: { baseURL?: string; apiKey?: string } }>
}

/** Strip a URL down to its origin; falls back to the raw string minus
 *  any query string when URL parsing fails. */
function endpointOrigin(raw: string): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.origin
  } catch {
    return raw.split('?')[0] || undefined
  }
}

function readConfig(path: string): OpenCodeConfigFile | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as OpenCodeConfigFile
  } catch {
    return null
  }
}

export interface ProvenanceOptions {
  /** Override the global config file path (tests). */
  globalConfigPath?: string
}

/** Resolve the provider provenance for a run from `taskDir`, honoring an
 *  explicit model override (task execution.model / flow node model,
 *  "provider/model" or a bare model id). Never throws - provenance is
 *  best-effort metadata, a broken config yields an empty result. */
export function resolveProviderProvenance(
  taskDir: string,
  modelOverride?: string,
  options?: ProvenanceOptions,
): ProviderProvenance {
  const workspace = readConfig(join(taskDir, '.opencode', 'opencode.json'))
  const globalPath =
    options?.globalConfigPath ??
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
      'opencode',
      'opencode.json',
    )
  const global = readConfig(globalPath)

  const provenance: ProviderProvenance = {}

  // Model resolution: explicit override > workspace > global
  let model: string | undefined
  if (modelOverride?.trim()) {
    model = modelOverride.trim()
    provenance.source = 'workspace' // pinned by the task/node definition
  } else if (workspace?.model) {
    model = workspace.model
    provenance.source = 'workspace'
  } else if (global?.model) {
    model = global.model
    provenance.source = 'global'
  }

  if (model) {
    const slash = model.indexOf('/')
    if (slash > 0) {
      provenance.provider = model.slice(0, slash)
      provenance.model = model.slice(slash + 1)
    } else {
      provenance.model = model
    }
  }

  // Endpoint: look the provider up in the layer that defined the model,
  // falling back to whichever layer declares it. Origin only - no secrets.
  const providerId = provenance.provider
  const entry =
    (providerId && workspace?.provider?.[providerId]?.options?.baseURL
      ? workspace.provider[providerId]
      : undefined) ??
    (providerId && global?.provider?.[providerId]?.options?.baseURL
      ? global.provider[providerId]
      : undefined)
  const baseURL = entry?.options?.baseURL
  if (baseURL) provenance.endpoint = endpointOrigin(baseURL)

  return provenance
}
