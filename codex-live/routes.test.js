/**
 * Contract tests for the two exact Fetch routes: status codes, headers, the
 * `refresh` forwarding, and the 400/502 mapping. The quota service is a fake, so
 * these assert the HTTP surface alone — the service's own tests cover what a
 * snapshot means.
 *
 * Run: node --test
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { quotaRoutes } from './routes.js'

const BASE = 'http://127.0.0.1:3080/api/codex-live/quota'

/** A service whose calls are recorded and whose answers the test chooses. */
function harness({ snapshot, consume } = {}) {
  const calls = []
  const routes = quotaRoutes({
    snapshot: async (options) => {
      calls.push({ kind: 'snapshot', options })
      return snapshot === undefined ? { status: 'ok', windows: [], credits: { availableCount: 0, items: [] } } : snapshot
    },
    consume: async (input) => {
      calls.push({ kind: 'consume', input })
      if (consume !== undefined) return consume(input)
      return { outcome: 'reset', windowsReset: 1 }
    },
  })
  return { routes, calls }
}

test('reads answer 200 with a JSON body and no-store, forwarding refresh', async () => {
  const { routes, calls } = harness({ snapshot: { status: 'no-credential', authPath: '~/.codex/auth.json' } })
  for (const [query, expected] of [['', false], ['?refresh=1', true], ['?refresh=0', false]]) {
    const response = await routes.read(new Request(`${BASE}${query}`))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { status: 'no-credential', authPath: '~/.codex/auth.json' })
    assert.deepEqual(calls.at(-1), { kind: 'snapshot', options: { refresh: expected } })
  }
  assert.equal(calls.length, 3)
})

test('reads keep a domain failure inside a 200, never as an HTTP error', async () => {
  const { routes } = harness({ snapshot: { status: 'upstream-error', detail: 'HTTP 503' } })
  const response = await routes.read(new Request(BASE))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'upstream-error', detail: 'HTTP 503' })
})

test('consume answers 200 with the service outcome', async () => {
  const { routes, calls } = harness()
  const response = await routes.consume(new Request(`${BASE}/consume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redeemRequestId: 'r1', creditId: 'credit-1' }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { outcome: 'reset', windowsReset: 1 })
  assert.deepEqual(calls, [{ kind: 'consume', input: { redeemRequestId: 'r1', creditId: 'credit-1' } }])
})

test('consume rejects a body that is not JSON', async () => {
  const { routes, calls } = harness()
  const response = await routes.consume(new Request(`${BASE}/consume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid-request' })
  assert.equal(calls.length, 0)
})

test('consume maps an invalid service rejection to 400 and an upstream one to 502', async () => {
  const invalid = harness({ consume: async () => { throw Object.assign(new Error('bad input'), { code: 'invalid' }) } })
  const invalidResponse = await invalid.routes.consume(new Request(`${BASE}/consume`, {
    method: 'POST', body: JSON.stringify({ redeemRequestId: '', creditId: '' }),
  }))
  assert.equal(invalidResponse.status, 400)
  assert.deepEqual(await invalidResponse.json(), { error: 'invalid-request', detail: 'bad input' })

  const upstream = harness({ consume: async () => { throw Object.assign(new Error('refused'), { code: 'upstream' }) } })
  const upstreamResponse = await upstream.routes.consume(new Request(`${BASE}/consume`, {
    method: 'POST', body: JSON.stringify({ redeemRequestId: 'r1', creditId: 'c1' }),
  }))
  assert.equal(upstreamResponse.status, 502)
  assert.deepEqual(await upstreamResponse.json(), { error: 'upstream-error', detail: 'refused' })
})
