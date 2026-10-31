/**
 * Behavior tests for the quota service: projection, error classification,
 * caching, single-flight, and redemption serialization, all driven through the
 * injected ports. No network is involved — `fetchJson`, `readAuth`, and `now`
 * are fakes, so every timing and failure mode is exact.
 *
 * Run: node --test
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createQuotaService } from './quota.js'

const BASE_URL = 'https://chatgpt.example/backend-api'
const NOW = 1_700_000_000_000
const USAGE_URL = `${BASE_URL}/wham/usage`
const CREDITS_URL = `${BASE_URL}/wham/rate-limit-reset-credits`
const CONSUME_URL = `${BASE_URL}/wham/rate-limit-reset-credits/consume`

/** A credential shaped like the one `auth.js` reads. */
const CREDENTIAL = {
  token: 'token-abc',
  path: '/home/test/.codex/auth.json',
  expiresAt: NOW + 3_600_000,
  accountId: 'account-42',
}

/** The `plus` account shape: two windows, no reset credits. */
function usage(overrides = {}) {
  return {
    plan_type: 'plus',
    email: 'user@example.com',
    rate_limit: {
      primary_window: { used_percent: 37.5, limit_window_seconds: 18000, reset_at: 1_700_000_100 },
      secondary_window: { used_percent: 8, limit_window_seconds: 604800, reset_after_seconds: 60 },
    },
    rate_limit_reset_credits: { available_count: 0 },
    ...overrides,
  }
}

/**
 * Build a service over recording fakes.
 * @param {object} [options] - per-test overrides.
 * @param {object | null} [options.auth] - credential; `null` means no login.
 * @param {object} [options.usage] - usage body served for `USAGE_URL`.
 * @param {object} [options.credits] - credit body served for `CREDITS_URL`.
 * @param {() => number} [options.now] - clock.
 * @param {string} [options.baseUrl] - ChatGPT surface.
 * @param {(url: string, init: object, count: number) => object | undefined} [options.respond]
 *   intercepts a request; returning `undefined` falls through to the defaults,
 *   throwing simulates a transport failure.
 * @returns {{ service: object, calls: { url: string, init: object }[] }} the service and its wire log.
 */
function harness({ auth = CREDENTIAL, usage: usageBody, credits, now = () => NOW, baseUrl = BASE_URL, respond, authPath } = {}) {
  const calls = []
  const fetchJson = async (url, init) => {
    calls.push({ url, init })
    if (respond !== undefined) {
      const intercepted = await respond(url, init, calls.length)
      if (intercepted !== undefined) return intercepted
    }
    if (url === USAGE_URL) return { status: 200, body: usageBody ?? usage() }
    if (url === CREDITS_URL) return { status: 200, body: credits ?? { credits: [] } }
    if (url === CONSUME_URL) return { status: 200, body: { code: 'reset', windows_reset: 1 } }
    throw new Error(`unexpected upstream URL ${url}`)
  }
  const service = createQuotaService({
    readAuth: async () => (auth === null ? undefined : auth),
    fetchJson,
    now,
    baseUrl,
    ...(authPath === undefined ? {} : { authPath }),
  })
  return { service, calls }
}

test('projects both windows in primary-then-secondary order', async () => {
  const { service } = harness()
  const view = await service.snapshot()

  assert.deepEqual(view, {
    status: 'ok',
    fetchedAt: NOW,
    plan: 'plus',
    email: 'user@example.com',
    windows: [
      { remainingPercent: 62.5, limitSeconds: 18000, resetsAt: 1_700_000_100_000 },
      // `reset_at` is absent here, so the relative field is anchored at `now()`.
      { remainingPercent: 92, limitSeconds: 604800, resetsAt: NOW + 60_000 },
    ],
    credits: { availableCount: 0, items: [] },
  })
})

test('keeps a lone month window and skips the null secondary', async () => {
  const { service } = harness({
    usage: usage({
      rate_limit: {
        primary_window: { used_percent: 100, limit_window_seconds: 2592000 },
        secondary_window: null,
      },
    }),
  })
  const view = await service.snapshot()

  assert.deepEqual(view.windows, [{ remainingPercent: 0, limitSeconds: 2592000 }])
})

test('classifies a missing or null rate limit as no-plan', async () => {
  for (const rateLimit of [null, undefined]) {
    const { service } = harness({ usage: usage({ rate_limit: rateLimit }) })
    assert.deepEqual(await service.snapshot(), { status: 'no-plan' })
  }
})

test('rejects unusable credentials before sending any request', async () => {
  const cases = [
    ['no credential', null, { status: 'no-credential' }],
    ['expired token', { ...CREDENTIAL, expiresAt: NOW }, { status: 'token-expired' }],
    ['API-key login', { token: 'sk-test', path: '/home/test/.codex/auth.json' }, { status: 'no-plan' }],
    ['empty account id', { ...CREDENTIAL, accountId: '' }, { status: 'no-plan' }],
  ]
  for (const [label, auth, expected] of cases) {
    const { service, calls } = harness({ auth })
    assert.deepEqual(await service.snapshot(), expected, label)
    assert.equal(calls.length, 0, label)
  }
})

test('maps HTTP statuses and transport failures without leaking details', async () => {
  const unauthorized = harness({
    respond: url => url === USAGE_URL ? { status: 401, body: { error: 'nope' } } : undefined,
  })
  assert.deepEqual(await unauthorized.service.snapshot(), { status: 'token-expired' })

  const unavailable = harness({
    respond: url => url === USAGE_URL ? { status: 503, body: 'down' } : undefined,
  })
  assert.deepEqual(await unavailable.service.snapshot(), { status: 'upstream-error', detail: 'HTTP 503' })

  const timedOut = harness({
    respond: () => { throw Object.assign(new Error('the token is secret'), { name: 'TimeoutError' }) },
  })
  assert.deepEqual(await timedOut.service.snapshot(), { status: 'upstream-error', detail: 'timeout' })

  const offline = harness({
    respond: () => { throw new TypeError('fetch failed') },
  })
  assert.deepEqual(await offline.service.snapshot(), { status: 'upstream-error', detail: 'network' })
})

test('caches one usage read for 60 seconds and lets refresh bypass it', async () => {
  let clock = NOW
  const { service, calls } = harness({ now: () => clock })

  const fresh = await service.snapshot()
  assert.equal(calls.length, 1)

  clock += 59_000
  // The cached answer is the same view, not a partial projection of it.
  assert.deepEqual(await service.snapshot(), fresh)
  assert.equal(calls.length, 1)

  await service.snapshot({ refresh: true })
  assert.equal(calls.length, 2)

  clock += 60_000
  await service.snapshot()
  assert.equal(calls.length, 3)
})

test('shares one in-flight snapshot between concurrent callers', async () => {
  const { service, calls } = harness()
  const views = await Promise.all([service.snapshot(), service.snapshot(), service.snapshot()])

  assert.equal(calls.length, 1)
  for (const view of views) assert.equal(view.status, 'ok')
})

test('does not request the credit list when the count is zero', async () => {
  const { service, calls } = harness()
  const view = await service.snapshot()

  assert.deepEqual(view.credits, { availableCount: 0, items: [] })
  assert.deepEqual(calls.map(call => call.url), [USAGE_URL])
})

test('degrades a failed credit read to unknown and retries it next time', async () => {
  const failures = [
    ['HTTP 500', () => ({ status: 500, body: undefined })],
    ['timeout', () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }],
    ['invalid JSON', () => { throw new SyntaxError('Unexpected token < in JSON') }],
  ]
  for (const [label, fail] of failures) {
    let failing = true
    const { service, calls } = harness({
      usage: usage({ rate_limit_reset_credits: { available_count: 2 } }),
      credits: { credits: [{ id: 'c1', status: 'available', title: 'Reset' }] },
      respond: (url) => {
        if (url === CREDITS_URL && failing) return fail()
        return undefined
      },
    })

    const degraded = await service.snapshot()
    assert.equal(degraded.status, 'ok', label)
    // The count still comes from usage; `null` means the list is unknown.
    assert.deepEqual(degraded.credits, { availableCount: 2, items: null }, label)

    failing = false
    const retried = await service.snapshot()
    assert.deepEqual(retried.credits, {
      availableCount: 2,
      items: [{ id: 'c1', title: 'Reset' }],
    }, label)
    assert.equal(calls.filter(call => call.url === CREDITS_URL).length, 2, label)
  }
})

test('keeps only available credits, sorted by expiry with undated ones last', async () => {
  const { service } = harness({
    usage: usage({ rate_limit_reset_credits: { available_count: 5 } }),
    credits: {
      credits: [
        { id: 'none', status: 'available', title: 'No date', description: '' },
        { id: 'late', status: 'available', title: 'Late', expires_at: '2025-01-02T00:00:00Z' },
        { id: 'used', status: 'used', title: 'Used', expires_at: '2024-12-01T00:00:00Z' },
        { id: 'early', status: 'available', title: 'Early', description: 'first', expires_at: '2025-01-01T00:00:00Z' },
      ],
    },
  })
  const view = await service.snapshot()

  assert.deepEqual(view.credits.items, [
    { id: 'early', title: 'Early', description: 'first', expiresAt: Date.parse('2025-01-01T00:00:00Z') },
    { id: 'late', title: 'Late', expiresAt: Date.parse('2025-01-02T00:00:00Z') },
    { id: 'none', title: 'No date' },
  ])
})

test('reports an empty list when every fetched credit is unavailable', async () => {
  const { service } = harness({
    usage: usage({ rate_limit_reset_credits: { available_count: 1 } }),
    credits: { credits: [{ id: 'used', status: 'used', title: 'Used' }] },
  })
  const view = await service.snapshot()

  assert.deepEqual(view.credits, { availableCount: 1, items: [] })
})

test('maps every upstream redemption code and rejects unknown ones', async () => {
  const cases = [
    ['reset', 'reset'],
    ['nothing_to_reset', 'nothing-to-reset'],
    ['no_credit', 'no-credit'],
    ['already_redeemed', 'already-redeemed'],
  ]
  for (const [code, outcome] of cases) {
    const { service } = harness({
      respond: url => url === CONSUME_URL ? { status: 200, body: { code, windows_reset: 2 } } : undefined,
    })
    assert.deepEqual(
      await service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' }),
      { outcome, windowsReset: 2 },
      code,
    )
  }

  const unknown = harness({
    respond: url => url === CONSUME_URL ? { status: 200, body: { code: 'mystery' } } : undefined,
  })
  await assert.rejects(
    unknown.service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' }),
    error => error.code === 'upstream',
  )
})

test('rejects non-2xx and transport failures with the upstream code', async () => {
  const refused = harness({
    respond: url => url === CONSUME_URL ? { status: 502, body: { code: 'reset' } } : undefined,
  })
  await assert.rejects(
    refused.service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' }),
    error => error.code === 'upstream' && !error.message.includes(CREDENTIAL.token),
  )

  const offline = harness({
    respond: () => { throw new TypeError('fetch failed') },
  })
  await assert.rejects(
    offline.service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' }),
    error => error.code === 'upstream' && !error.message.includes(CREDENTIAL.token),
  )
})

test('serializes redemptions: the second request waits for the first to settle', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let first = true
  const { service, calls } = harness({
    respond: async (url) => {
      if (url !== CONSUME_URL) return undefined
      if (!first) return { status: 200, body: { code: 'nothing_to_reset' } }
      first = false
      await gate
      return { status: 200, body: { code: 'reset', windows_reset: 1 } }
    },
  })

  const one = service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' })
  const two = service.consume({ redeemRequestId: 'request-2', creditId: 'credit-2' })

  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(call => call.url), [CONSUME_URL])

  release()
  const [firstResult, secondResult] = await Promise.all([one, two])
  assert.deepEqual(firstResult, { outcome: 'reset', windowsReset: 1 })
  assert.deepEqual(secondResult, { outcome: 'nothing-to-reset' })
  assert.deepEqual(calls.map(call => call.url), [CONSUME_URL, CONSUME_URL])
})

test('clears both caches after a redemption, successful or not', async () => {
  let failing = false
  const { service, calls } = harness({
    respond: (url) => {
      if (url === CONSUME_URL && failing) return { status: 500, body: undefined }
      return undefined
    },
  })

  await service.snapshot()
  assert.equal(calls.filter(call => call.url === USAGE_URL).length, 1)

  await service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' })
  await service.snapshot()
  assert.equal(calls.filter(call => call.url === USAGE_URL).length, 2)

  failing = true
  await assert.rejects(
    service.consume({ redeemRequestId: 'request-2', creditId: 'credit-2' }),
    error => error.code === 'upstream',
  )
  failing = false
  await service.snapshot()
  assert.equal(calls.filter(call => call.url === USAGE_URL).length, 3)
})

test('rejects malformed identifiers without sending a request', async () => {
  const { service, calls } = harness()
  const invalid = [
    { redeemRequestId: '', creditId: 'credit-1' },
    { redeemRequestId: 'request-1', creditId: 'x'.repeat(201) },
    { redeemRequestId: 42, creditId: 'credit-1' },
    {},
  ]
  for (const input of invalid) {
    await assert.rejects(service.consume(input), error => error.code === 'invalid')
  }
  assert.equal(calls.length, 0)
})

test('sends the ChatGPT-surface headers and joins URLs below baseUrl', async () => {
  const { service, calls } = harness({
    usage: usage({ rate_limit_reset_credits: { available_count: 1 } }),
    credits: { credits: [{ id: 'credit-1', status: 'available', title: 'Reset' }] },
  })

  await service.snapshot()
  assert.deepEqual(calls.map(call => call.url), [USAGE_URL, CREDITS_URL])

  const usageCall = calls[0]
  assert.equal(usageCall.init.method, 'GET')
  assert.equal(usageCall.init.headers.Authorization, `Bearer ${CREDENTIAL.token}`)
  assert.equal(usageCall.init.headers['ChatGPT-Account-Id'], CREDENTIAL.accountId)
  assert.equal(usageCall.init.headers['User-Agent'], 'codex-cli')
  assert.equal(usageCall.init.headers.Accept, 'application/json')
  assert.ok(usageCall.init.signal instanceof AbortSignal)

  await service.consume({ redeemRequestId: 'request-1', creditId: 'credit-1' })
  const consumeCall = calls.at(-1)
  assert.equal(consumeCall.url, CONSUME_URL)
  assert.equal(consumeCall.init.method, 'POST')
  assert.equal(consumeCall.init.headers['content-type'], 'application/json')
  assert.equal(consumeCall.init.headers.Authorization, `Bearer ${CREDENTIAL.token}`)
  assert.deepEqual(JSON.parse(consumeCall.init.body), {
    redeem_request_id: 'request-1',
    credit_id: 'credit-1',
  })
})

test('tolerates a baseUrl with a trailing slash', async () => {
  const { service, calls } = harness({ baseUrl: `${BASE_URL}/` })
  await service.snapshot()

  assert.deepEqual(calls.map(call => call.url), [USAGE_URL])
})

test('names the configured credential path in credential statuses', async () => {
  const missing = harness({ auth: null, authPath: '~/.codex/auth.json' })
  assert.deepEqual(await missing.service.snapshot(), { status: 'no-credential', authPath: '~/.codex/auth.json' })

  const expired = harness({ auth: { ...CREDENTIAL, expiresAt: NOW - 1 }, authPath: '/srv/codex/auth.json' })
  assert.deepEqual(await expired.service.snapshot(), { status: 'token-expired', authPath: '/srv/codex/auth.json' })

  // A 401 names the same file the page's hint would: the credential was read.
  const rejected = harness({
    authPath: '/srv/codex/auth.json',
    respond: url => (url === USAGE_URL ? { status: 401, body: undefined } : undefined),
  })
  assert.deepEqual(await rejected.service.snapshot(), { status: 'token-expired', authPath: '/srv/codex/auth.json' })

  // Without the option, the status stays path-free and the page keeps its fallback.
  const bare = harness({ auth: null })
  assert.deepEqual(await bare.service.snapshot(), { status: 'no-credential' })
})
