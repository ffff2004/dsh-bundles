/**
 * Live OpenAI Codex provider.
 *
 * A second route (`codex-live` by default) whose model catalog follows the
 * local codex CLI instead of the pi-ai catalog built into this deployment, and
 * whose requests carry the codex CLI's own ChatGPT token.
 *
 * ## Why a provider instead of `llm-pi-ai` configuration
 *
 * A profile may add a model the installed catalog does not describe, but the
 * capability switches its wire protocol takes — `supportsToolSearch`,
 * `supportsAdditionalTools`, `supportsOpenAIGrammarTools`,
 * `supportsMidConvoSystemMessages` — are withheld from configuration: the
 * installed catalog is their only source, and spelling one in `config` is
 * refused outright. A provider built here hands pi-ai the `Model` objects
 * themselves, so a model newer than the catalog keeps those switches, while a
 * model the catalog already ships is passed through verbatim (id and route
 * excepted), inheriting cost, capacities, compatibility, and input limits.
 *
 * ## Where the facts come from
 *
 * - The catalog list: `models_cache.json` in the codex home, which the codex
 *   CLI refreshes from its own backend whenever it runs. A model the installed
 *   pi-ai catalog does not know is synthesized from the closest same-family
 *   sibling: compatibility and image limits come from that sibling, while the
 *   name, context window, modalities, and reasoning levels come from the codex
 *   entry itself.
 * - The credential: `tokens.access_token` (or `OPENAI_API_KEY`) in `auth.json`
 *   in the same home. The token is read per request, so a refresh the codex CLI
 *   performs reaches the next request without a restart; an expired one fails
 *   with a message naming the file rather than a bare 401.
 *
 * Neither file is written, and nothing here talks to codex: the provider is
 * exactly as fresh as the last time the codex CLI ran.
 *
 * @module @local/dsh-codex-live
 */

import { watch } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import z from '@deepseek-ai/schemastery'

import { AUTH_FILE, authFileDisplayPath, readCodexAuth } from './auth.js'
import { withoutPromptCacheKey } from './prompt-cache.js'
import { createQuotaService } from './quota.js'
import { quotaRoutes } from './routes.js'

/** The pi-ai catalog route this provider mirrors; its entries are the metadata source. */
const CATALOG_PROVIDER = 'openai-codex'

/** The codex cache the model list is read from. */
const CACHE_FILE = 'models_cache.json'

/** Coalescing window for filesystem events: codex rewrites the cache atomically, in bursts. */
const WATCH_DEBOUNCE_MS = 1500

/*
 * Request-side knobs copied from `llm-pi-ai`'s own route defaults, because the
 * adapter reads them from the resolved profile this plugin hands it. They are
 * constants rather than config: each is a deployment-wide policy whose only
 * per-route value this route has no reason to differ from.
 */
const STREAM_IDLE_TIMEOUT_MS = 300_000
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024

/** Cordis plugin name. */
export const name = 'codex-live'

/** The LLM registry this route registers into. */
export const inject = ['llm']

/** Exact Host route serving the quota snapshot; the browser half holds a copy. */
export const QUOTA_PATH = '/api/codex-live/quota'

/** Exact Host route spending one reset credit; the browser half holds a copy. */
export const CONSUME_PATH = '/api/codex-live/quota/consume'

/** Runtime schema for the row's `config`. */
export const Config = z.object({
  /** Route key every request and every selector names; must not collide with another adapter's. */
  route: z.string().default('codex-live'),
  /** Label shown by selectors and the Models page. */
  displayName: z.string().default('OpenAI Codex (live)'),
  /** Codex home holding `auth.json` and `models_cache.json`; empty reads `CODEX_HOME`, then `~/.codex`. */
  codexHome: z.string().default(''),
  /** Endpoint the route speaks; the codex backend's ChatGPT surface. */
  baseUrl: z.string().default('https://chatgpt.com/backend-api'),
  /** Serve models the codex picker hides (`visibility: "hide"`) as well. */
  includeHidden: z.boolean().default(false),
  /** Model ids to serve even when hidden, or when `includeHidden` is off. */
  include: z.array(z.string()).default([]),
  /** Model ids to leave out of this route. */
  exclude: z.array(z.string()).default([]),
  /**
   * Catalog model whose compatibility and image limits a synthesized model
   * copies. Empty picks the closest same-family sibling automatically.
   */
  template: z.string().default(''),
  /** Output capability for a synthesized model; the codex cache reports none. */
  maxTokens: z.number().step(1).min(1).default(128_000),
  /**
   * Wire spelling for a request that names no effort on a synthesized model.
   * Empty keeps such a request free of a reasoning block — the model's own
   * default — which is what a codex model accepting only `low`..`max` requires:
   * pi-ai falls back to the literal `"none"` for a map with no `off` key at all,
   * and the backend refuses `"none"` for exactly those models.
   */
  offEffort: z.string().default(''),
  /** Apply the codex entry's `effective_context_window_percent` to its context window. */
  useEffectiveContextPercent: z.boolean().default(true),
  /** Context window by model id, overriding everything derived for that id. */
  contextWindow: z.dict(z.number().step(1).min(1)).default({}),
  /**
   * Credential reference to fall back to when the codex home carries no token.
   * Empty disables the fallback and makes a missing codex login fail loud.
   */
  tokenRef: z.string().default(''),
  /** Rebuild the catalog when codex rewrites its state. */
  watch: z.boolean().default(true),
})

/**
 * Register the live Codex route.
 * @param ctx - Host context carrying the `llm` registry and optional services.
 * @param config - validated row configuration.
 */
export function apply(ctx, config) {
  const route = config.route
  const codexHome = config.codexHome.length > 0
    ? config.codexHome
    : (process.env.CODEX_HOME ?? '').length > 0 ? process.env.CODEX_HOME : join(homedir(), '.codex')

  // The wire implementation and the metadata source, both from this bundle's own
  // pi-ai dependency; `PiAiAdapter` builds its collection from the provider below.
  const api = openAICodexResponsesApi()
  const catalog = new Map(getBuiltinModels(CATALOG_PROVIDER).map(model => [model.id, model]))

  /**
   * The credential the request path hands pi-ai as its api-key override.
   * @returns the bearer token, read fresh so a codex refresh reaches the next request.
   * @throws LlmError when the codex home carries no usable token.
   */
  const resolveToken = async () => {
    const stored = await readCodexAuth(codexHome)
    if (stored !== undefined) {
      if (stored.expiresAt !== undefined && stored.expiresAt <= Date.now()) {
        throw new LlmError(
          `codex-live: the token in ${stored.path} expired at ${new Date(stored.expiresAt).toISOString()};`
          + ' run the codex CLI once to refresh it, or point `tokenRef` at a credential ref',
          'MISSING_CREDENTIAL',
        )
      }
      return stored.token
    }
    if (config.tokenRef.length > 0) {
      const credentials = ctx.get('credentials')
      const hit = credentials === undefined
        ? launchEnvironmentOf(ctx).get(config.tokenRef)?.value
        : (await credentials.resolve(config.tokenRef))?.value
      if (hit !== undefined && hit.length > 0) return hit
    }
    throw new LlmError(
      `codex-live: no token in ${join(codexHome, AUTH_FILE)}`
      + `${config.tokenRef.length > 0 ? ` and none for the "${config.tokenRef}" reference` : ''};`
      + ' sign in with the codex CLI (or set `tokenRef`) to serve this route',
      'MISSING_CREDENTIAL',
    )
  }

  /** Immutable per-rebuild state, and the profile map whose identity is the adapter's change signal. */
  let current = { models: [], signature: '', notes: [] }
  let profiles
  let handle

  /** Whether one codex entry belongs on this route. */
  const keep = (entry, slug) => {
    if (config.exclude.includes(slug)) return false
    if (config.include.includes(slug)) return true
    return config.includeHidden || entry.visibility === 'list'
  }

  /** The resolved profile the adapter reads; rebuilt only when the catalog changes. */
  const profileFor = (models) => ({
    provider: route,
    displayName: config.displayName,
    piProvider: provider,
    models,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
  })

  /** Build the route's models from the codex cache, the installed catalog, and this row's config. */
  const buildModels = (cache) => {
    const entries = cache === undefined || !Array.isArray(cache.models) ? undefined : cache.models
    if (entries === undefined || entries.length === 0) {
      return { models: [...catalog.values()].map(model => ({ ...model, provider: route })), notes: [] }
    }
    const notes = []
    const ordered = [...entries].sort((left, right) => priorityOf(left) - priorityOf(right))
    const models = []
    for (const entry of ordered) {
      const slug = entry?.slug
      if (typeof slug !== 'string' || slug.length === 0) continue
      if (!keep(entry, slug)) continue
      const known = catalog.get(slug)
      if (known !== undefined) {
        models.push({ ...known, provider: route })
        continue
      }
      const template = pickTemplate(entry, ordered, catalog, config.template)
      if (template === undefined) {
        notes.push(`skipped "${slug}": the installed catalog ships nothing to model it on`)
        continue
      }
      const contextWindow = contextWindowOf(entry, template, config)
      const maxTokens = config.maxTokens > 0 ? config.maxTokens : template.maxTokens
      const input = modalitiesOf(entry, template)
      const thinkingLevelMap = levelMapOf(entry, config.offEffort)
      models.push({
        ...template,
        id: slug,
        name: typeof entry.display_name === 'string' && entry.display_name.length > 0 ? entry.display_name : slug,
        provider: route,
        contextWindow,
        maxTokens,
        input,
        ...thinkingLevelMap === undefined ? {} : { thinkingLevelMap },
      })
      notes.push(
        `synthesized "${slug}" from catalog template "${template.id}"`
        + ` (contextWindow ${contextWindow}, maxTokens ${maxTokens},`
        + ` reasoning ${thinkingLevelMap === undefined ? 'inherited' : Object.keys(thinkingLevelMap).join('/')})`,
      )
    }
    return { models, notes }
  }

  /**
   * Read the codex cache, rebuild the route, and re-publish only when the served
   * catalog actually changed — every other codex field is irrelevant here.
   * @param reason - what caused the read, for the log line.
   * @returns whether the served catalog changed.
   */
  const refresh = async (reason) => {
    const cache = await readCache()
    const next = buildModels(cache)
    const signature = signatureOf(next.models)
    if (signature === current.signature) return false
    current = { models: next.models, notes: next.notes, signature }
    profiles = new Map([[route, profileFor(current.models)]])
    // Re-registration re-publishes `llm/adapters-updated`, which is what makes
    // every open selector reload without a restart.
    handle?.replace([route])
    ctx.logger.info(
      'codex-live: %s model(s) from %s (route "%s", %s)',
      current.models.length,
      cache === undefined ? 'the installed catalog' : join(codexHome, CACHE_FILE),
      route,
      reason,
    )
    for (const note of current.notes) ctx.logger.info('codex-live: %s', note)
    return true
  }

  /** Read the codex cache, or undefined when it is missing or unreadable. */
  const readCache = async () => {
    try {
      return JSON.parse(await readFile(join(codexHome, CACHE_FILE), 'utf8'))
    } catch (error) {
      ctx.logger.warn(
        'codex-live: cannot read %s (%s); serving the installed catalog unchanged',
        join(codexHome, CACHE_FILE),
        error instanceof Error ? error.message : String(error),
      )
      return undefined
    }
  }

  const provider = {
    id: route,
    name: config.displayName,
    baseUrl: config.baseUrl,
    /*
     * pi-ai honours the request-level `apiKey` override only when the provider
     * declares api-key auth, and reads this method only when no override
     * arrived — the status path. It therefore never throws: an unavailable
     * token must not make the route look broken before anyone sends anything.
     */
    auth: {
      apiKey: {
        name: config.displayName,
        resolve: async ({ credential }) => {
          const key = credential?.key ?? await readCodexAuth(codexHome).then(
            stored => stored?.expiresAt !== undefined && stored.expiresAt <= Date.now() ? undefined : stored?.token,
            () => undefined,
          )
          return key === undefined
            ? { auth: {}, source: join(codexHome, AUTH_FILE) }
            : { auth: { apiKey: key }, source: join(codexHome, AUTH_FILE) }
        },
      },
    },
    getModels: () => current.models,
    stream: (model, context, options) => api.stream(model, context, withoutPromptCacheKey(options)),
    streamSimple: (model, context, options) => api.streamSimple(model, context, withoutPromptCacheKey(options)),
  }

  profiles = new Map([[route, profileFor(current.models)]])

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async (providerId) => providerId === route ? await resolveToken() : undefined,
    /*
     * A route that always resolves its own token never consults pi-ai's stored
     * credentials, but the collection still requires a store and an ambient
     * context: this route stores nothing there, and the ambient answers come
     * from the harness launch environment exactly as every other route's do.
     */
    auth: {
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async () => undefined,
        delete: async () => {},
      },
      authContext: {
        env: async (key) => launchEnvironmentOf(ctx).get(key)?.value,
        fileExists: async (path) => {
          try {
            await access(path.replace(/^~(?=$|[\\/])/, homedir()))
            return true
          } catch {
            return false
          }
        },
      },
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider: degraded, model, reason }) => {
      ctx.logger.warn(
        'codex-live: unusable replay state on assistant history for "%s/%s";'
        + ' sending that message as provider-neutral content (%s)',
        degraded,
        model,
        reason,
      )
    },
  })

  handle = ctx.llm.registerAdapter([route], adapter)
  void refresh('startup').catch((error) => {
    ctx.logger.error('codex-live: initial catalog build failed', error)
  })

  if (config.watch) {
    ctx.effect(() => {
      let timer
      let watcher
      try {
        watcher = watch(codexHome, (_event, filename) => {
          if (filename !== null && filename !== CACHE_FILE && filename !== AUTH_FILE) return
          clearTimeout(timer)
          // Codex rewrites the cache atomically and in bursts; one coalesced
          // rebuild per burst keeps the reload and the selectors quiet.
          timer = setTimeout(() => {
            void refresh('after a codex update').catch((error) => {
              ctx.logger.warn('codex-live: rebuild after a codex update failed', error)
            })
          }, WATCH_DEBOUNCE_MS)
        })
        watcher.on('error', (error) => ctx.logger.warn('codex-live: watch on %s failed: %s', codexHome, String(error)))
      } catch (error) {
        ctx.logger.warn('codex-live: cannot watch %s; the catalog is read at startup only', codexHome, error)
      }
      return () => {
        clearTimeout(timer)
        watcher?.close()
      }
    }, 'codex-live.watch')
  }

  // Report an already-expired (or imminently expiring) token once per mount, so a
  // route that cannot authenticate says so in the log rather than at first use.
  void readCodexAuth(codexHome).then((stored) => {
    if (stored === undefined) {
      ctx.logger.warn('codex-live: no codex credential in %s yet', join(codexHome, AUTH_FILE))
      return
    }
    if (stored.expiresAt === undefined) return
    const remaining = stored.expiresAt - Date.now()
    if (remaining <= 0) {
      ctx.logger.warn(
        'codex-live: the token in %s expired at %s; run the codex CLI once to refresh it',
        stored.path,
        new Date(stored.expiresAt).toISOString(),
      )
    } else if (remaining < 24 * 60 * 60 * 1000) {
      ctx.logger.info('codex-live: the token in %s expires %s', stored.path, new Date(stored.expiresAt).toISOString())
    }
  })

  const quota = createQuotaService({
    baseUrl: config.baseUrl,
    readAuth: () => readCodexAuth(codexHome),
    fetchJson,
    now: Date.now,
    // The page prints this in its "run codex" hint, so it must follow `codexHome`.
    authPath: authFileDisplayPath(codexHome),
  })

  /*
   * `connection` is injected here rather than declared at module level: these
   * routes are one feature of the provider, and a composition without a Web
   * connection must keep serving the route's models. The injection also scopes
   * route ownership, so both disappear when the connection does.
   */
  ctx.inject(['connection'], (scoped) => {
    const routes = quotaRoutes(quota)
    scoped.connection.fetch.register({
      path: QUOTA_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: routes.read,
    })
    scoped.connection.fetch.register({
      path: CONSUME_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: routes.consume,
    })
  })
}

/**
 * One JSON request against the codex backend.
 *
 * Non-2xx responses are returned, not thrown: the quota service owns the
 * classification, and parsing the error body here would only risk echoing it.
 * A transport failure or a body that is not JSON rejects, which the service
 * degrades per request.
 *
 * @param url - absolute endpoint.
 * @param init - method, headers, optional JSON body, and abort signal.
 * @returns the HTTP status and, for a 2xx, the parsed body.
 */
async function fetchJson(url, { method, headers, body, signal }) {
  const response = await fetch(url, { method, headers, body, signal })
  if (response.status < 200 || response.status >= 300) return { status: response.status, body: undefined }
  const text = await response.text()
  return { status: response.status, body: text.length === 0 ? undefined : JSON.parse(text) }
}

/** Codex's own ordering key; entries without one keep their place after the ordered ones. */
function priorityOf(entry) {
  return typeof entry?.priority === 'number' ? entry.priority : Number.MAX_SAFE_INTEGER
}

/**
 * The catalog model a synthesized model copies its capabilities from: the
 * configured template when it names one, then the catalog sibling sharing the
 * longest id prefix (which keeps a family's compatibility switches together),
 * then the sibling the codex backend ranks best.
 * @param entry - the codex cache entry being synthesized.
 * @param ordered - every cache entry, in codex's order.
 * @param catalog - the installed catalog by model id.
 * @param configured - the row's explicit template id, possibly empty.
 * @returns the template model, or undefined when the catalog is empty.
 */
function pickTemplate(entry, ordered, catalog, configured) {
  if (configured.length > 0 && catalog.has(configured)) return catalog.get(configured)
  const rank = new Map()
  for (const candidate of ordered) rank.set(candidate?.slug, priorityOf(candidate))
  let best
  let bestPrefix = -1
  let bestRank = Number.POSITIVE_INFINITY
  for (const [id, model] of catalog) {
    const prefix = commonPrefixLength(id, entry.slug)
    const priority = rank.get(id) ?? Number.MAX_SAFE_INTEGER
    if (prefix > bestPrefix || (prefix === bestPrefix && priority < bestRank)) {
      best = model
      bestPrefix = prefix
      bestRank = priority
    }
  }
  return best
}

/** Length of the shared leading run of two model ids. */
function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/**
 * The context window to advertise: an explicit override, then the codex entry's
 * window scaled by its own `effective_context_window_percent` (what the CLI
 * itself treats as usable), then the template's.
 * @param entry - the codex cache entry.
 * @param template - the catalog model it is synthesized from.
 * @param config - the row's validated configuration.
 * @returns the context window in tokens.
 */
function contextWindowOf(entry, template, config) {
  const override = config.contextWindow[entry.slug]
  if (typeof override === 'number' && Number.isInteger(override) && override > 0) return override
  const window = Number(entry.context_window)
  if (!Number.isFinite(window) || window <= 0) return template.contextWindow
  if (!config.useEffectiveContextPercent) return Math.floor(window)
  const percent = Number(entry.effective_context_window_percent)
  const usable = Number.isFinite(percent) && percent > 0 ? percent : 100
  return Math.max(1, Math.floor(window * usable / 100))
}

/** The declared modalities, filtered to what pi-ai models; the template's when the entry states none. */
function modalitiesOf(entry, template) {
  const declared = Array.isArray(entry.input_modalities)
    ? entry.input_modalities.filter(modality => modality === 'text' || modality === 'image')
    : []
  return declared.length === 0 ? [...template.input] : [...new Set(declared)]
}

/**
 * pi-ai's thinking-level map for a synthesized model, from the codex entry's own
 * offered efforts. Every pi-ai level the entry does not offer is pinned to null
 * so no selector offers it.
 *
 * `off` is the one level that must be spelled out: pi-ai's codex request builder
 * sends `thinkingLevelMap.off ?? "none"` for a request that names no effort
 * whenever that key is not null, and a model whose ladder starts at `low`
 * refuses `"none"` — so an absent `off` breaks exactly the default request. An
 * explicit null keeps that request free of a reasoning block, at the cost of
 * DSH's own picker treating the level as unsupported and hiding it, which is
 * what the upstream catalog entry for such a model carries as well.
 * @param entry - the codex cache entry.
 * @param offEffort - configured wire spelling for `off`; empty means null.
 * @returns the map, or undefined when the entry reports no reasoning levels.
 */
function levelMapOf(entry, offEffort) {
  const levels = Array.isArray(entry.supported_reasoning_levels)
    ? entry.supported_reasoning_levels.flatMap(level => typeof level?.effort === 'string' ? [level.effort] : [])
    : []
  if (levels.length === 0) return undefined
  const offered = new Set(levels)
  const wire = level => offered.has(level) ? level : null
  return {
    off: typeof offEffort === 'string' && offEffort.length > 0 ? offEffort : null,
    // The codex ladder has no "minimal"; pi-ai's lowest thinking level is what
    // its cheapest real effort means, which is also how the installed catalog
    // spells this for the models it ships.
    minimal: offered.has('minimal') ? 'minimal' : offered.has('low') ? 'low' : null,
    low: wire('low'),
    medium: wire('medium'),
    high: wire('high'),
    xhigh: wire('xhigh'),
    max: wire('max'),
  }
}

/**
 * The change signal for one built catalog: everything the picker and the
 * request path read, so a rewrite that changes only unrelated codex fields
 * (prompts, tool flags) does not re-register the route.
 * @param models - the built models, in route order.
 * @returns a stable string.
 */
function signatureOf(models) {
  return JSON.stringify(models.map(model => [
    model.id,
    model.name,
    model.contextWindow,
    model.maxTokens,
    model.input,
    model.thinkingLevelMap ?? null,
  ]))
}
