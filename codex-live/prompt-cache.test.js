import assert from 'node:assert/strict'
import test from 'node:test'

import { withoutPromptCacheKey } from './prompt-cache.js'

test('removes only the body key and preserves session and request options', async () => {
  const options = { sessionId: 'session-123', cacheRetention: 'long', signal: new AbortController().signal }
  const wrapped = withoutPromptCacheKey(options)
  const body = { prompt_cache_key: 'session-123', model: 'gpt-5.6', input: [] }

  assert.equal(wrapped.sessionId, options.sessionId)
  assert.equal(wrapped.cacheRetention, options.cacheRetention)
  assert.equal(wrapped.signal, options.signal)
  assert.equal(options.onPayload, undefined)
  assert.equal(await wrapped.onPayload(body, {}), body)
  assert.equal(Object.hasOwn(body, 'prompt_cache_key'), false)
  assert.deepEqual(body, { model: 'gpt-5.6', input: [] })
})

test('supports missing options without disabling caching', async () => {
  const wrapped = withoutPromptCacheKey()
  assert.equal(Object.hasOwn(wrapped, 'cacheRetention'), false)
  assert.deepEqual(await wrapped.onPayload({ input: [] }, {}), { input: [] })
})

test('runs a mutating callback before removing the key', async () => {
  const model = { id: 'gpt-5.6' }
  const body = { prompt_cache_key: 'original' }
  const wrapped = withoutPromptCacheKey({
    onPayload(payload, receivedModel) {
      assert.equal(payload, body)
      assert.equal(receivedModel, model)
      payload.prompt_cache_key = 'overridden'
      payload.store = false
    },
  })

  assert.deepEqual(await wrapped.onPayload(body, model), { store: false })
})

test('uses an async callback replacement and removes its key', async () => {
  const replacement = { prompt_cache_key: 'replacement', input: ['updated'] }
  const wrapped = withoutPromptCacheKey({ onPayload: async () => replacement })

  assert.equal(await wrapped.onPayload({ prompt_cache_key: 'original' }, {}), replacement)
  assert.deepEqual(replacement, { input: ['updated'] })
})

test('propagates callback failures', async () => {
  const error = new Error('callback failed')
  const wrapped = withoutPromptCacheKey({ onPayload: async () => { throw error } })

  await assert.rejects(wrapped.onPayload({}, {}), candidate => candidate === error)
})
