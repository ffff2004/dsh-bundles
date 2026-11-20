import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import renderer from 'react-test-renderer'

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8')
const slot = 'conversation.session.header.utilities'
const target = (repository, ...remotes) => ({ repository, url: `https://github.com/${repository}`, remotes })
const fork = target('me/project', 'origin', 'backup')
const upstream = target('org/project', 'upstream')
const tree = { items: [{ workspaceId: 'workspace / 1', sessionIds: ['one'] }, { workspaceId: 'two', sessionIds: ['two'] }] }

function setup(fetch) {
  let plugin
  let Component
  runInNewContext(`${source};\n${source}`, {
    AbortController, URLSearchParams, fetch,
    window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, '@ffff2004-dsh-packages/github-link')
      plugin = factory(name => { assert.equal(name, 'react'); return React })
    } } },
  })
  plugin.apply({
    effect() {},
    slots: {
      inject(name, register) { assert.equal(name, slot); register() },
      register({ name, id }, render) { assert.equal(name, slot); assert.equal(id, 'workspace-github-link'); Component = render },
    },
  })
  return sessionId => React.createElement(Component, { sessionId, useWorkspaces: select => select(tree), t: key => key })
}

async function mount(t, view) {
  let ui
  await renderer.act(async () => { ui = renderer.create(view) })
  t.after(() => renderer.act(() => ui.unmount()))
  return ui
}

function response(...links) {
  return { ok: true, json: async () => ({ links }) }
}

test('no workspace, no GitHub remote, and denied workspace stay hidden', async t => {
  const calls = []
  const view = setup(async url => { calls.push(url); return url.endsWith('=two') ? { ok: false } : response() })
  const ui = await mount(t, view('unknown'))
  assert.equal(ui.toJSON(), null)
  assert.deepEqual(calls, [])
  await renderer.act(async () => ui.update(view('one')))
  assert.equal(ui.toJSON(), null)
  assert.deepEqual(calls, ['api/github-link?workspaceId=workspace+%2F+1'])
  await renderer.act(async () => ui.update(view('two')))
  assert.equal(ui.toJSON(), null)
  assert.equal(calls.at(-1), 'api/github-link?workspaceId=two')
})

test('one repository is a direct link; multiple repositories use a labeled popover', async t => {
  const view = setup(async url => url.endsWith('=two') ? response(fork, upstream) : response(fork))
  const ui = await mount(t, view('one'))
  const direct = ui.root.findByType('a')
  assert.equal(direct.props.href, fork.url)
  assert.equal(direct.props.target, '_blank')
  assert.equal(direct.props.rel, 'noopener noreferrer')
  assert.equal(direct.props['aria-label'], 'open: me/project (newTab)')
  assert.equal(ui.root.findAllByProps({ popover: 'auto' }).length, 0)

  await renderer.act(async () => ui.update(view('two')))
  const trigger = ui.root.findByType('button')
  assert.equal(trigger.props['aria-label'], 'choose')
  const panel = ui.root.findByProps({ popover: 'auto' })
  assert.ok(panel.props.id)
  assert.equal(trigger.props.popovertarget, panel.props.id)

  const links = panel.findAllByType('a')
  assert.deepEqual(links.map(link => link.props.href), [fork.url, upstream.url])
  assert.deepEqual(links.map(link => link.props['aria-label']), [
    'me/project (origin, backup; newTab)',
    'org/project (upstream; newTab)',
  ])
  assert.ok(links.every(link => link.props.target === '_blank' && link.props.rel === 'noopener noreferrer'))
})

test('a late response from the previous workspace cannot replace the new entry', async t => {
  let signal
  let resolveOld
  const view = setup(async (url, options) => {
    if (url.endsWith('=two')) return response(upstream)
    signal = options.signal
    return new Promise(resolve => { resolveOld = resolve })
  })
  const ui = await mount(t, view('one'))
  assert.equal(ui.toJSON(), null)
  await renderer.act(async () => ui.update(view('two')))
  assert.equal(signal.aborted, true)
  await renderer.act(async () => resolveOld(response(fork)))
  assert.equal(ui.root.findByType('a').props.href, upstream.url)
})
