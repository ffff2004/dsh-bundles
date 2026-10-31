/**
 * The ChatGPT quota surface behind the `codex-live` provider.
 *
 * The provider serves models; this service serves the account state those
 * models run on: the plan, the two rate-limit windows, and the reset credits
 * that can be spent against them. It is read/write against the ChatGPT backend
 * but owns no route — `index.js` registers the routes and hands the browser
 * half the frozen JSON shape documented on {@link createQuotaService}.
 *
 * ## Why usage and credits are separate requests
 *
 * Usage is one request and always needed; credits are a second request the
 * backend can fail independently. A page that cannot read credits must still
 * show its windows, so a credit failure degrades to `items: null` ("unknown")
 * instead of failing the snapshot, while `items: []` keeps its distinct
 * meaning of "fetched, and there are none".
 *
 * ## Why the caching lives here
 *
 * Settings tabs are opened repeatedly and several can be open at once. Two 60s
 * caches with single-flight promise sharing keep the refresh button honest
 * (`refresh: true` bypasses both) without letting N tabs become N upstream
 * calls. A failed credit read is deliberately not cached: the next open is the
 * natural retry, while the usage result that carried `availableCount` is.
 *
 * @module @local/dsh-codex-live/quota
 */

/** Path suffix for the usage snapshot, below the configured ChatGPT surface. */
const USAGE_ENDPOINT = '/wham/usage'

/** Path suffix for the reset-credit list. */
const CREDITS_ENDPOINT = '/wham/rate-limit-reset-credits'

/** Path suffix for spending one reset credit. */
const CONSUME_ENDPOINT = '/wham/rate-limit-reset-credits/consume'

/** Both projections share one TTL: the page reads them as one snapshot. */
const CACHE_TTL_MS = 60_000

/*
 * The usage request is on the page's critical path, so it may spend a little
 * longer; the credit list is supplementary and a slow one is not worth a
 * spinner, hence the shorter budget.
 */
const USAGE_TIMEOUT_MS = 10_000
const CREDITS_TIMEOUT_MS = 4_000

/** A redemption is a write; give it the same budget as the usage read. */
const CONSUME_TIMEOUT_MS = 10_000

/** Wire bound on both redemption identifiers. */
const MAX_IDENTIFIER_LENGTH = 200

/** Wire `code` → the outcome the browser half switches on. */
const OUTCOMES = new Map([
  ['reset', 'reset'],
  ['nothing_to_reset', 'nothing-to-reset'],
  ['no_credit', 'no-credit'],
  ['already_redeemed', 'already-redeemed'],
])

/**
 * Build the quota service for one `codex-live` row.
 *
 * `snapshot()` resolves to the frozen view the browser half consumes:
 * `{ status: 'ok', fetchedAt, plan, email, windows, credits }`, or one of
 * `no-credential` / `token-expired` / `no-plan` / `upstream-error` with an
 * optional non-secret `detail`. `consume()` resolves to
 * `{ outcome, windowsReset? }` or rejects with `code: 'invalid' | 'upstream'`.
 *
 * @param {object} options - injected ports; every one exists for testability.
 * @param {() => Promise<{ token: string, path: string, expiresAt?: number, accountId?: string } | undefined>} options.readAuth
 *   reads the codex credential; the service never writes it.
 * @param {(url: string, init: { method: string, headers: Record<string, string>, body?: string, signal: AbortSignal }) => Promise<{ status: number, body: unknown }>} options.fetchJson
 *   performs one JSON request; must reject on network failure/timeout and
 *   return every HTTP status, leaving classification to this service.
 * @param {() => number} options.now - current time in ms.
 * @param {string} options.baseUrl - ChatGPT surface, normally ending in `/backend-api`.
 * @returns {{ snapshot: (options?: { refresh?: boolean }) => Promise<object>, consume: (input: { redeemRequestId: string, creditId: string }) => Promise<{ outcome: string, windowsReset?: number }> }}
 *   the two operations the Host routes expose.
 */
export function createQuotaService({ readAuth, fetchJson, now, baseUrl, authPath }) {
  /**
   * Bumped whenever a redemption invalidates the caches. A request that started
   * under an older epoch still resolves for its caller, but must not seed the
   * cache with data from before the reset.
   */
  let epoch = 0

  /**
   * The credential when it can talk to the ChatGPT surface, or the status that
   * says why it cannot. One predicate keeps the read path and the redemption
   * path from disagreeing about who counts as logged in.
   * @returns {Promise<{ credential: object } | { status: string }>} exactly one half.
   */
  const usableCredential = async () => {
    const credential = await currentCredential()
    if (credential === undefined) return { status: 'no-credential' }
    // Checked before any request: an expired JWT is a known fact, and asking
    // upstream would only turn it into a 401 with less context.
    if (credential.expiresAt !== undefined && credential.expiresAt <= now()) return { status: 'token-expired' }
    // The account id is a mandatory header rather than a credential: without it
    // every ChatGPT-surface request is doomed, and an API-key login carries none.
    if (typeof credential.accountId !== 'string' || credential.accountId.length === 0) return { status: 'no-plan' }
    return { credential }
  }

  /**
   * A non-`ok` status, naming the credential file when the row knows it.
   * `codexHome` is configurable, so the page must not keep guessing a path that
   * its own login hint would then contradict.
   */
  const statusWithPath = status => (typeof authPath === 'string' && authPath.length > 0 ? { status, authPath } : { status })

  /** Keep `path` on the configured surface without doubling a trailing slash. */
  const endpoint = path => `${baseUrl.replace(/\/+$/, '')}${path}`

  /**
   * Headers every ChatGPT-surface request carries. The account id is sent as
   * received: it is not a secret, and the backend rejects a mismatched one.
   */
  const headersFor = credential => ({
    Authorization: `Bearer ${credential.token}`,
    'ChatGPT-Account-Id': credential.accountId,
    'User-Agent': 'codex-cli',
    Accept: 'application/json',
  })

  /**
   * Read the credential, treating an unreadable file as "not logged in".
   * `readCodexAuth` already swallows filesystem errors; a rejected promise here
   * would be an injected port misbehaving, and degrading beats a 500.
   */
  const currentCredential = async () => {
    try {
      return await readAuth()
    } catch {
      return undefined
    }
  }

  /**
   * One usage request. Every outcome is modelled as a value: this is the only
   * place that talks to `/wham/usage`, and it must never leak a token or a
   * response body through an error.
   */
  const fetchUsage = async (credential) => {
    let response
    try {
      response = await fetchJson(endpoint(USAGE_ENDPOINT), {
        method: 'GET',
        headers: headersFor(credential),
        signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
      })
    } catch (error) {
      return { status: 'upstream-error', detail: failureDetail(error) }
    }
    if (response.status === 401) return statusWithPath('token-expired')
    if (response.status < 200 || response.status >= 300) {
      return { status: 'upstream-error', detail: `HTTP ${response.status}` }
    }
    const body = response.body
    const rateLimit = body?.rate_limit
    // An API-key account answers 200 with no rate limit at all: it has no
    // ChatGPT plan windows to show, which is distinct from a transport failure.
    if (rateLimit === null || typeof rateLimit !== 'object') return { status: 'no-plan' }
    const resetCredits = body?.rate_limit_reset_credits
    const windows = []
    for (const raw of [rateLimit.primary_window, rateLimit.secondary_window]) {
      const window = projectWindow(raw, now)
      if (window !== undefined) windows.push(window)
    }
    return {
      status: 'ok',
      usage: {
        // The instant the upstream value became known, not the instant a cached
        // copy is served; the page labels its freshness with this.
        fetchedAt: now(),
        plan: typeof body.plan_type === 'string' ? body.plan_type : '',
        email: typeof body.email === 'string' ? body.email : '',
        windows,
        availableCount: finiteNumberOr(resetCredits?.available_count, 0),
      },
    }
  }

  /**
   * One credit-list request. Returns the projected list, or `undefined` for any
   * failure — the caller keeps the usage-derived count either way.
   */
  const fetchCredits = async (credential) => {
    let response
    try {
      response = await fetchJson(endpoint(CREDITS_ENDPOINT), {
        method: 'GET',
        headers: headersFor(credential),
        signal: AbortSignal.timeout(CREDITS_TIMEOUT_MS),
      })
    } catch {
      return undefined
    }
    if (response.status < 200 || response.status >= 300) return undefined
    const raw = response.body?.credits
    if (!Array.isArray(raw)) return undefined
    return raw
      .map(projectCredit)
      .filter(item => item !== undefined)
      .sort((left, right) => (left.expiresAt ?? Number.POSITIVE_INFINITY)
        - (right.expiresAt ?? Number.POSITIVE_INFINITY))
  }

  /**
   * One 60s memo with single-flight. A service instance serves exactly one
   * account, so each projection owns one slot; the redemption epoch keeps a read
   * that started before a reset from seeding the cache with pre-reset data.
   * @param {(credential: object) => Promise<unknown>} read - one upstream read.
   * @param {(value: unknown) => boolean} cacheable - whether that result may be cached.
   * @param {(value: unknown) => number} stampedAt - the instant the value became known.
   * @returns {(credential: object, refresh: boolean) => Promise<unknown>} the cached read.
   */
  const memo = (read, cacheable, stampedAt) => {
    let cache
    let inFlight
    /** The cached read. `clear` drops the slot; callers holding a result keep it. */
    const load = (credential, refresh) => {
      if (!refresh && cache !== undefined && now() - cache.at < CACHE_TTL_MS) {
        return Promise.resolve(cache.value)
      }
      // Single-flight: a refresh that lands on an in-flight read shares it rather
      // than racing another request, and every concurrent caller shares too.
      if (inFlight !== undefined) return inFlight
      const started = epoch
      const pending = read(credential).then((value) => {
        if (cacheable(value) && started === epoch) cache = { at: stampedAt(value), value }
        return value
      })
      inFlight = pending
      const settle = () => {
        if (inFlight === pending) inFlight = undefined
      }
      void pending.then(settle, settle)
      return pending
    }
    load.clear = () => { cache = undefined }
    return load
  }

  /** Usage is cached only when the read succeeded; its fetch instant stamps it. */
  const loadUsage = memo(
    credential => fetchUsage(credential),
    result => result.status === 'ok',
    result => result.usage.fetchedAt,
  )

  /** A credit failure (`undefined`) is not cached: the next open retries it. */
  const loadCredits = memo(
    credential => fetchCredits(credential),
    items => items !== undefined,
    () => now(),
  )

  /** Drop both projections after a redemption changed what upstream would say. */
  const clearCaches = () => {
    epoch += 1
    loadUsage.clear()
    loadCredits.clear()
  }

  /**
   * The account's current quota view.
   * @param {{ refresh?: boolean }} [options] - `refresh` bypasses both caches.
   * @returns {Promise<object>} the frozen view documented on the factory.
   */
  const snapshot = async ({ refresh = false } = {}) => {
    const planned = await usableCredential()
    if (planned.status !== undefined) {
      // Only the credential statuses name the file the user must refresh.
      return planned.status === 'no-plan' ? planned : statusWithPath(planned.status)
    }
    const usage = await loadUsage(planned.credential, refresh)
    if (usage.status !== 'ok') return usage
    const { fetchedAt, plan, email, windows, availableCount } = usage.usage
    // No credits to describe means no reason to ask for the list: an empty
    // account must cost one request, not two.
    const items = availableCount === 0
      ? []
      : (await loadCredits(planned.credential, refresh)) ?? null
    return { status: 'ok', fetchedAt, plan, email, windows, credits: { availableCount, items } }
  }

  /*
   * Redemptions are writes against a shared account, and two confirmations
   * landing together must not race: each occupies the queue until it settles,
   * so the backend sees them one after another even when a tab retries.
   */
  let consumeTail = Promise.resolve()

  /**
   * Spend one reset credit.
   * @param {{ redeemRequestId: string, creditId: string }} input - caller-generated
   *   idempotency key and the credit to spend.
   * @returns {Promise<{ outcome: string, windowsReset?: number }>} the mapped upstream outcome.
   * @throws an `Error` carrying `code: 'invalid'` for malformed input, or
   *   `code: 'upstream'` when the backend refused or the transport failed.
   */
  const consume = async (input = {}) => {
    const { redeemRequestId, creditId } = input
    if (!isIdentifier(redeemRequestId) || !isIdentifier(creditId)) {
      // Validation stays outside the queue: a malformed body must not wait for,
      // or delay, a real redemption.
      throw codedError(
        'invalid',
        `codex-live: redeemRequestId and creditId must be non-empty strings of at most ${MAX_IDENTIFIER_LENGTH} characters`,
      )
    }
    const previous = consumeTail
    let release
    consumeTail = new Promise((resolve) => { release = resolve })
    await previous
    try {
      return await postConsume(redeemRequestId, creditId)
    } finally {
      // A redemption invalidates both projections whether it succeeded or not:
      // a failed attempt can still have changed upstream state, and the next
      // snapshot must not answer from before the attempt.
      clearCaches()
      release()
    }
  }

  /**
   * Send one redemption; assumes exclusive access to the account, which the
   * queue above provides.
   */
  const postConsume = async (redeemRequestId, creditId) => {
    const planned = await usableCredential()
    if (planned.status !== undefined) {
      throw codedError('upstream', `codex-live: the codex credential cannot redeem reset credits (${planned.status})`)
    }
    let response
    try {
      response = await fetchJson(endpoint(CONSUME_ENDPOINT), {
        method: 'POST',
        headers: { ...headersFor(planned.credential), 'content-type': 'application/json' },
        body: JSON.stringify({ redeem_request_id: redeemRequestId, credit_id: creditId }),
        signal: AbortSignal.timeout(CONSUME_TIMEOUT_MS),
      })
    } catch {
      // The error may carry the request (and therefore the token); only the
      // generic message is ever surfaced.
      throw codedError('upstream', 'codex-live: the reset-credit request failed')
    }
    if (response.status < 200 || response.status >= 300) {
      throw codedError('upstream', `codex-live: the reset-credit request failed with HTTP ${response.status}`)
    }
    const code = response.body?.code
    const outcome = OUTCOMES.get(code)
    if (outcome === undefined) {
      throw codedError('upstream', 'codex-live: the reset-credit response carried an unknown outcome')
    }
    const windowsReset = response.body?.windows_reset
    return typeof windowsReset === 'number' && Number.isFinite(windowsReset)
      ? { outcome, windowsReset }
      : { outcome }
  }

  return { snapshot, consume }
}

/**
 * Project one upstream rate-limit window, or nothing when the backend sent
 * `null` (a free plan has a primary window only, for example).
 * @param {unknown} raw - one `*_window` object.
 * @param {() => number} now - clock used to anchor a relative reset.
 * @returns {{ limitSeconds: number, remainingPercent: number, resetsAt?: number } | undefined}
 *   the view window, in the frozen shape.
 */
function projectWindow(raw, now) {
  if (raw === null || typeof raw !== 'object') return undefined
  const window = {}
  const limitSeconds = finiteNumberOr(raw.limit_window_seconds, undefined)
  if (limitSeconds !== undefined) window.limitSeconds = limitSeconds
  const usedPercent = finiteNumberOr(raw.used_percent, undefined)
  // The page shows what is left, and a backend that reports no usage is a
  // fully available window rather than an unknown one.
  window.remainingPercent = usedPercent === undefined ? 100 : clamp(100 - usedPercent, 0, 100)
  const resetsAt = resetInstant(raw, now)
  if (resetsAt !== undefined) window.resetsAt = resetsAt
  return window
}

/**
 * The window's reset instant in ms: `reset_at` when upstream sent one, else the
 * relative `reset_after_seconds` anchored at the read instant.
 * @param {object} raw - one upstream window.
 * @param {() => number} now - clock used to anchor the relative field.
 * @returns {number | undefined} the reset instant, or undefined when neither field is usable.
 */
function resetInstant(raw, now) {
  const fixed = finiteNumberOr(raw.reset_at, undefined)
  if (fixed !== undefined) return fixed * 1000
  const after = finiteNumberOr(raw.reset_after_seconds, undefined)
  if (after !== undefined) return now() + after * 1000
  return undefined
}

/**
 * Project one upstream reset credit, keeping only spendable ones.
 * @param {unknown} raw - one entry of the credit list.
 * @returns {{ id: string, title: string, description?: string, expiresAt?: number } | undefined}
 *   the view item, or undefined when it is not an available credit.
 */
function projectCredit(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  if (raw.status !== 'available') return undefined
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined
  const item = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
  }
  // An empty description is absent, not an empty line on the page.
  if (typeof raw.description === 'string' && raw.description.length > 0) item.description = raw.description
  const expiresAt = instantOf(raw.expires_at)
  if (expiresAt !== undefined) item.expiresAt = expiresAt
  return item
}

/**
 * Parse an RFC3339 timestamp into ms, ignoring anything else.
 * @param {unknown} value - upstream timestamp.
 * @returns {number | undefined} the instant, or undefined when absent/unparseable.
 */
function instantOf(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Classify a thrown transport error without echoing it.
 * @param {unknown} error - whatever `fetchJson` rejected with.
 * @returns {'timeout' | 'network'} the wire-safe detail.
 */
function failureDetail(error) {
  const name = error?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

/** A finite number from the wire, else the fallback (which is `undefined` for absent fields). */
function finiteNumberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Clamp without rounding: percentages stay as precise as upstream sent them. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** A redemption identifier the wire accepts. */
function isIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH
}

/** An Error the routes can classify without inspecting a private cause. */
function codedError(code, message) {
  return Object.assign(new Error(message), { code })
}
