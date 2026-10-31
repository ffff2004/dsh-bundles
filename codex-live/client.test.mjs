/**
 * Browser-half tests for the Codex quota page.
 *
 * `client.js` is a plain script that hands its factory to
 * `window.__ModuleLoader__`; the test installs that global, imports the file,
 * and calls the factory with fake platform modules. No browser, network, or
 * installed dependency is needed. The pure functions are reached through the
 * factory's `__test` field; the component itself is never rendered here.
 *
 * Run: node --test
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const clientSource = await readFile(new URL('./client.js', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('./index.js', import.meta.url), 'utf8')

/** Factory registration captured from the module-loader global. */
let registered

const previousWindow = globalThis.window
globalThis.window = {
  __ModuleLoader__: {
    load(manifest) { registered = manifest },
  },
}
try {
  await import('./client.js')
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

/** Minimal React surface: the factory only wires it up, the component is not rendered. */
const React = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState() {},
  useEffect() {},
  useMemo(factory) { return factory() },
  useCallback(callback) { return callback },
  useRef() { return { current: undefined } },
  useId() { return 'id' },
}

/** The two primitives the factory requires; both are placeholders here. */
const primitives = { Modal: () => null, Button: () => null }

/** The factory result, including the test-only `__test` surface. */
const factory = registered.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected platform require: ${specifier}`)
})
const api = factory.__test

test('manifest declares the browser half and the settings-shell dependency', () => {
  assert.equal(packageJson.exports['./client'], './client.js')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'))
  assert.deepEqual(packageJson.dsh.bundle, { patch: './cordis.patch.yml' })
  assert.equal(registered.id, '@local/dsh-codex-live')
  assert.deepEqual(factory.inject, ['slots', 'locale'])
})

test('client.js is one IIFE with a single module-loader statement', () => {
  const stripped = clientSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trim()
  assert.match(stripped, /^;\(function \(\) \{/)
  assert.ok(stripped.endsWith('})()'))
  assert.equal(/\bimport\s/u.test(stripped), false, 'no import declarations')
  assert.equal(/\bexport\s/u.test(stripped), false, 'no export declarations')
  assert.equal((stripped.match(/__ModuleLoader__\.load\(/g) ?? []).length, 1)
  assert.equal((stripped.match(/\bload\(/g) ?? []).length, 1, 'the loader is the only `load(` call')
})

test('the browser routes agree with the Host path constants', () => {
  const hostQuota = hostSource.match(/export const QUOTA_PATH = ['"]([^'"]+)['"]/u)?.[1]
  const hostConsume = hostSource.match(/export const CONSUME_PATH = ['"]([^'"]+)['"]/u)?.[1]
  const clientQuota = clientSource.match(/const QUOTA_URL = ['"]([^'"]+)['"]/u)?.[1]
  const clientConsume = clientSource.match(/const CONSUME_URL = ['"]([^'"]+)['"]/u)?.[1]
  assert.ok(hostQuota !== undefined && clientQuota !== undefined)
  assert.ok(hostConsume !== undefined && clientConsume !== undefined)
  assert.equal(`/${clientQuota}`, hostQuota)
  assert.equal(`/${clientConsume}`, hostConsume)
})

test('windowLabel switches from rounded hours to rounded days at 48 hours', () => {
  assert.equal(api.windowLabel(18000), '5 小时')
  assert.equal(api.windowLabel(604800), '7 天')
  assert.equal(api.windowLabel(2592000), '30 天')
  assert.equal(api.windowLabel(90000), '25 小时')
  assert.equal(api.windowLabel(259200), '3 天')
  assert.equal(api.windowLabel(3600), '1 小时')
  assert.equal(api.windowLabel(1800), '1 小时')
  assert.equal(api.windowLabel(undefined), '窗口')
})

test('formatInstant keeps time-only on the same local day and names the date otherwise', () => {
  const now = new Date(2025, 10, 6, 12, 0).getTime()
  const sameDay = new Date(2025, 10, 6, 21, 27).getTime()
  const nextDay = new Date(2025, 10, 7, 9, 5).getTime()
  assert.equal(api.formatInstant(sameDay, now, api.tZh, 'zh'), '21:27')
  assert.equal(api.formatInstant(nextDay, now, api.tZh, 'zh'), '11 月 7 日 09:05')
  assert.equal(api.formatInstant(nextDay, now, api.tEn, 'en'), 'Nov 7, 09:05')
})

test('decorateCredits orders by expiry and picks the earliest credit plus the seven-day horizon', () => {
  const day = 24 * 60 * 60 * 1000
  const now = new Date(2025, 0, 10, 12, 0).getTime()
  const items = [
    { id: 'undated' },
    { id: 'later', expiresAt: now + 8 * day },
    { id: 'boundary', expiresAt: now + 7 * day },
    { id: 'tie-a', expiresAt: now + 2 * day },
    { id: 'tie-b', expiresAt: now + 2 * day },
  ]
  const before = items.map(item => item.id)
  const decorated = api.decorateCredits(items, now)
  assert.deepEqual(decorated.sorted.map(item => item.id), ['tie-a', 'tie-b', 'boundary', 'later', 'undated'])
  assert.equal(decorated.nearest.id, 'tie-a')
  assert.deepEqual(decorated.expiringSoonIds, ['tie-a', 'tie-b', 'boundary'])
  assert.deepEqual(items.map(item => item.id), before, 'the input order is preserved')

  const expired = api.decorateCredits([{ id: 'expired', expiresAt: now - 10 * day }], now)
  assert.equal(expired.nearest.id, 'expired')
  assert.deepEqual(expired.expiringSoonIds, ['expired'])

  const undated = api.decorateCredits([{ id: 'only' }], now)
  assert.equal(undated.nearest, undefined)
  assert.deepEqual(undated.expiringSoonIds, [])
})

test('builds the consume body from the credit the dialog opened with', () => {
  const credit = { id: 'credit-1', title: 'Full reset' }
  const body = api.consumePayload({ redeemRequestId: 'r1', credit })
  assert.deepEqual(body, { redeemRequestId: 'r1', creditId: 'credit-1' })
  assert.ok(Object.values(body).every(value => typeof value === 'string' && value.length > 0))
  assert.equal(api.consumePayload({ redeemRequestId: 'r2', credit: { id: 'credit-2' } }).creditId, 'credit-2')
})

test('remainingPercentOf rounds and clamps the remaining percentage', () => {
  assert.equal(api.remainingPercentOf({ remainingPercent: 94.6 }), 95)
  assert.equal(api.remainingPercentOf({ remainingPercent: 5.4 }), 5)
  assert.equal(api.remainingPercentOf({ remainingPercent: 5.5 }), 6)
  assert.equal(api.remainingPercentOf({ remainingPercent: -2 }), 0)
  assert.equal(api.remainingPercentOf({ remainingPercent: 140 }), 100)
  assert.equal(api.remainingPercentOf({}), 100)
  assert.equal(100 - api.remainingPercentOf({ remainingPercent: 89.6 }), 10)
})

test('outcomeText covers every outcome with non-empty copy', () => {
  assert.equal(api.outcomeText('reset', 2), '已重置 2 个窗口')
  assert.equal(api.outcomeText('reset'), '已重置')
  assert.equal(api.outcomeText('nothing-to-reset'), '当前没有需要重置的用量，券未消耗')
  assert.equal(api.outcomeText('no-credit'), '没有可用重置券')
  assert.equal(api.outcomeText('already-redeemed'), '这张券已生效或已被使用')
  const fake = (key, params) => `${key}${params === undefined ? '' : JSON.stringify(params)}`
  for (const outcome of ['reset', 'nothing-to-reset', 'no-credit', 'already-redeemed']) {
    assert.ok(api.outcomeText(outcome, undefined, fake).length > 0)
  }
})

test('the Chinese and English dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(api.zh).sort(), Object.keys(api.en).sort())
})

test('apply registers the codex-quota section and both dictionaries', () => {
  let registration
  let dictionaries
  const ctx = {
    effect(factory) { return factory() },
    locale: {
      register(ns, dicts) { dictionaries = { ns, dicts }; return () => {} },
      bind() { return key => key },
      getSnapshot() { return { active: 'zh' } },
    },
    slots: {
      inject(_key, callback) { callback() },
      register(options, component) { registration = { options, component }; return () => {} },
    },
  }
  factory.apply(ctx)
  assert.equal(dictionaries.ns, 'codexQuota')
  assert.deepEqual(Object.keys(dictionaries.dicts).sort(), ['en', 'zh'])
  assert.equal(registration.options.name, 'settings.section')
  assert.equal(registration.options.id, 'codex-quota')
  assert.equal(registration.options.order, -5)
  assert.equal(registration.options.locale, 'codexQuota')
  assert.equal(registration.options.label(), 'nav')
  assert.equal(typeof registration.component, 'function')
})

test('names the Host-reported credential path, falling back to the default home', () => {
  assert.equal(api.authPathOf({ status: 'no-credential' }), '~/.codex/auth.json')
  assert.equal(api.authPathOf({ status: 'no-credential', authPath: '' }), '~/.codex/auth.json')
  assert.equal(api.authPathOf({ status: 'token-expired', authPath: '/srv/codex/auth.json' }), '/srv/codex/auth.json')
  assert.equal(api.authPathOf(undefined), '~/.codex/auth.json')
})
