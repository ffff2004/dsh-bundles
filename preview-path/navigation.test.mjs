// Behavioral tests with real React hooks. These check navigation intents and
// lifetimes, not browser layout or the Host's tab planner.
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'

let registration
globalThis.window = { __ModuleLoader__: { load: row => { registration = row } } }
await import('./client.js')
const plugin = registration.factory(name => {
  assert.equal(name, 'react')
  return React
})
const directoryKind = 'preview-path-directory'
const notRegular = { ok: false, error: { code: 'workspace-file/not-regular-file' } }
const key = value => value
const event = key => ({ key, preventDefault() {}, stopPropagation() {} })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(t) {
  const rows = new Map()
  const types = []
  const opens = []
  const stats = []
  const listings = []
  const disposers = []
  let statResult = { ok: true, value: {} }
  let target = { tabId: 'toolbar-tab' }
  let current = true
  let commands
  let commandsDisposed = 0
  const opener = replace => ({
    openTab: (kind, options) => opens.push({ kind, options, source: replace }),
    openResource: (address, options) => opens.push({ address, options, source: replace }),
  })
  const ctx = {
    effect: callback => disposers.push(callback()),
    locale: { register: () => () => {}, bind: () => key },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { rows.set(options.name, component); return () => {} },
    },
    sidebarRightTabs: { register: type => { types.push(type); return () => {} } },
    sidebarRight: {
      ...opener('service'), focusedTarget: () => target, isTargetCurrent: () => current,
    },
    remote: { workspaceFiles: {
      stat: (sessionId, path, signal) => {
        stats.push({ sessionId, path, signal })
        return Promise.resolve(statResult)
      },
      list: async (_sessionId, path, signal) => {
        listings.push({ path, signal })
        return { ok: true, value: {
          path: path === '/ws' ? '' : 'sub', truncated: false,
          entries: [{ name: 'child', type: 'directory' }, { name: 'a.txt', type: 'file' }, { name: 'link', type: 'other' }],
        } }
      },
    } },
  }
  plugin.apply(ctx)
  const common = { sessionId: 's1', t: key }
  const controller = new AbortController()
  let tab = {
    id: 'directory-1', signal: controller.signal,
    navigation: { params: { path: '/ws/sub' }, revision: 1 },
    actions: {
      ...opener('directory-1'),
      bindCommands: next => {
        commands = next
        return () => { commands = undefined; commandsDisposed++ }
      },
    },
  }
  const bodyProps = {
    ...common,
    useTabInfo: () => ({ tab }),
    useSessions: select => select({ byId: { s1: { cwd: '/ws' } } }),
    list: (path, signal) => ctx.remote.workspaceFiles.list('s1', path, signal),
  }
  const trees = []
  async function mount(name, props = {}) {
    let tree
    await act(async () => {
      tree = create(React.createElement(rows.get(name), { ...common, ...props }), {
        createNodeMock: () => ({ focus() {}, select() {}, closest() { return null } }),
      })
    })
    trees.push(tree)
    return tree
  }
  t.after(async () => {
    await act(async () => { for (const tree of trees) tree.unmount() })
    for (const dispose of disposers.reverse()) dispose?.()
  })
  return {
    rows, types, opens, stats, listings, controller, bodyProps, mount,
    body: () => mount('sidebar.right.pane.tab', bodyProps),
    stat: result => { statResult = result },
    target: value => { target = value },
    current: value => { current = value },
    tab: value => { tab = { ...tab, ...value } },
    get commands() { return commands },
    get commandsDisposed() { return commandsDisposed },
  }
}

const find = (tree, marker) => tree.root.findByProps({ [marker]: '' })
const click = async node => act(async () => { node.props.onClick() })
async function edit(tree, draft) {
  await click(find(tree, 'data-preview-path-tool'))
  await act(async () => { tree.root.findByType('input').props.onChange({ target: { value: draft } }) })
}
const enter = async tree => act(async () => { tree.root.findByType('input').props.onKeyDown(event('Enter')) })
const expectedPage = (path, replaceTab) => ({ replaceTab, revealIfOpened: false, params: { path } })

test('multiple pages and one replacement policy for both opener contracts', () => {
  const calls = []
  const opener = {
    openTab: (kind, options) => calls.push({ kind, options }),
    openResource: (address, options) => calls.push({ address, options }),
  }
  const { createPathNavigator } = plugin.__test
  for (const replaceTab of ['source-tab', true]) {
    const go = createPathNavigator(opener, 's1', replaceTab)
    go('/ws/sub', 'directory')
    assert.deepEqual(calls.pop(), { kind: directoryKind, options: expectedPage('/ws/sub', replaceTab) })
    go('/ws/a.txt', 'file')
    assert.deepEqual(calls.pop(), {
      address: 'dsh-resource://file/session/s1//ws/a.txt',
      options: { replaceTab, revealIfOpened: false },
    })
  }
  assert.throws(() => createPathNavigator(opener, 's1', undefined))
})

test('directory rows and parent navigate via the tab, never local path state', async t => {
  const f = fixture(t)
  const tree = await f.body()
  await click(tree.root.findByProps({ 'data-preview-path-name': 'child' }))
  assert.deepEqual(f.opens.pop(), { kind: directoryKind, options: expectedPage('/ws/sub/child', true), source: 'directory-1' })
  // The Host has not applied the intent: the body still reads its tab's path.
  assert.equal(find(tree, 'data-preview-path-directory').props['data-preview-path-root'], '/ws/sub')
  await click(tree.root.findByProps({ 'data-preview-path-name': 'a.txt' }))
  assert.deepEqual(f.opens.pop(), {
    address: 'dsh-resource://file/session/s1//ws/sub/a.txt',
    options: { replaceTab: true, revealIfOpened: false }, source: 'directory-1',
  })
  await click(find(tree, 'data-preview-path-up'))
  assert.deepEqual(f.opens.pop().options, expectedPage('/ws', true))
  assert.equal(tree.root.findByProps({ 'data-preview-path-name': 'link' }).props.disabled, true)
})

test('directory typed file and directory use the same tab replacement', async t => {
  const f = fixture(t)
  const tree = await f.body()
  for (const [path, result] of [['/ws/other', notRegular], ['/ws/b.txt', { ok: true }]]) {
    f.stat(result)
    await edit(tree, path)
    await enter(tree)
    const opened = f.opens.pop()
    assert.equal(opened.source, 'directory-1')
    assert.equal(opened.options.replaceTab, true)
    assert.equal(opened.options.revealIfOpened, false)
    if (result.ok) assert.equal(opened.address, 'dsh-resource://file/session/s1//ws/b.txt')
    else assert.deepEqual(opened.options.params, { path })
  }
})

test('directory reads navigation parameters; refresh only reloads and cleans bindings', async t => {
  const f = fixture(t)
  const tree = await f.body()
  assert.equal(f.listings.length, 1)
  await act(async () => { f.commands.refresh() })
  assert.equal(f.listings.length, 2)
  assert.equal(f.opens.length, 0)
  const previous = f.listings.at(-1)
  f.tab({ navigation: { params: { path: '/ws/new' }, revision: 2 } })
  await act(async () => { tree.update(React.createElement(f.rows.get('sidebar.right.pane.tab'), f.bodyProps)) })
  assert.equal(previous.signal.aborted, true)
  assert.equal(f.listings.at(-1).path, '/ws/new')
  assert.equal(find(tree, 'data-preview-path-directory').props['data-preview-path-root'], '/ws/new')
  await act(async () => { tree.unmount() })
  assert.equal(f.commandsDisposed, 1)
  assert.equal(f.listings.at(-1).signal.aborted, true)
})

test('guide defaults to root; two page instances keep separate sources', async t => {
  const f = fixture(t)
  const a = await f.body()
  const aProps = { ...f.bodyProps,
    // A multi-segment workspace root: only the listing-derived floor keeps the
    // up button disabled here, because parentOf('/repo/ws') is '/repo'.
    useSessions: select => select({ byId: { s1: { cwd: '/repo/ws' } } }),
    list: async () => ({ ok: true, value: {
      path: '', truncated: false,
      entries: [{ name: 'child', type: 'directory' }, { name: 'a.txt', type: 'file' }, { name: 'link', type: 'other' }],
    } }),
    useTabInfo: () => ({ tab: {
    id: 'directory-2', signal: new AbortController().signal,
    navigation: { params: undefined, revision: 0 },
    actions: {
      bindCommands: () => () => {},
      openTab: (kind, options) => f.opens.push({ kind, options, source: 'directory-2' }),
    },
  } }) }
  const b = await f.mount('sidebar.right.pane.tab', aProps)
  assert.equal(find(b, 'data-preview-path-directory').props['data-preview-path-root'], '/repo/ws')
  assert.equal(find(b, 'data-preview-path-up').props.disabled, true)
  await click(b.root.findByProps({ 'data-preview-path-name': 'child' }))
  assert.equal(f.opens.pop().source, 'directory-2')
  assert.equal(find(a, 'data-preview-path-directory').props['data-preview-path-root'], '/ws/sub')
})

for (const seat of ['document', 'files']) {
  test(`${seat} toolbar classifies typed paths and replaces its own tab`, async t => {
    const f = fixture(t)
    const tree = await f.mount(`sidebar.right.tab.${seat}.actions`, { absolutePath: '/ws/a.txt' })
    for (const result of [{ ok: true }, notRegular]) {
      f.stat(result)
      await edit(tree, '/ws/target')
      await enter(tree)
      const opened = f.opens.pop()
      assert.equal(opened.options.replaceTab, 'toolbar-tab')
      assert.equal(opened.options.revealIfOpened, false)
      if (result.ok) assert.equal(opened.address, 'dsh-resource://file/session/s1//ws/target')
      else assert.deepEqual(opened.options.params, { path: '/ws/target' })
    }
  })
}

test('preview parent and menu use the shared replacement policy', async t => {
  const f = fixture(t)
  const tree = await f.mount('sidebar.right.tab.document.actions', { absolutePath: '/ws/sub/a.txt' })
  await click(find(tree, 'data-preview-path-parent'))
  assert.deepEqual(f.opens.pop().options, expectedPage('/ws/sub', 'toolbar-tab'))
  let dismissed = false
  const menu = await f.mount('sidebar.right.tab.menu.item', {
    tab: { id: 'menu-tab', contentId: 'dsh-resource://file/session/s1//ws/missing' },
    dismiss: () => { dismissed = true },
  })
  await click(find(menu, 'data-preview-path-open-directory'))
  assert.equal(dismissed, true)
  assert.deepEqual(f.opens.pop().options, expectedPage('/ws/missing', 'menu-tab'))
  // The menu opens the directory page directly; it must not stat the path first.
  assert.equal(f.stats.length, 0)
})

test('unchanged, empty, and failed inputs do not navigate', async t => {
  const f = fixture(t)
  const tree = await f.body()
  await edit(tree, '/ws/sub')
  await enter(tree)
  assert.equal(f.stats.length, 0)
  await edit(tree, '  ')
  await enter(tree)
  assert.equal(f.stats.length, 0)
  assert.equal(tree.root.findByProps({ role: 'alert' }).children[0], 'empty')
  await act(async () => { tree.root.findByType('input').props.onKeyDown(event('Escape')) })
  f.stat({ ok: false, error: { code: 'workspace-file/not-found' } })
  await edit(tree, '/ws/missing')
  await enter(tree)
  assert.equal(tree.root.findByProps({ role: 'alert' }).children[0], 'notFound')
  assert.equal(f.opens.length, 0)
})

test('a stale or unresolved toolbar source cannot create an unrelated tab', async t => {
  const f = fixture(t)
  const tree = await f.mount('sidebar.right.tab.document.actions', { absolutePath: '/ws/a.txt' })
  const pending = deferred()
  f.stat(pending.promise)
  await edit(tree, '/ws/b.txt')
  await enter(tree)
  f.current(false)
  await act(async () => { pending.resolve({ ok: true }) })
  assert.equal(f.opens.length, 0)
  assert.equal(tree.root.findByProps({ role: 'alert' }).children[0], 'failed')
  await act(async () => { tree.root.findByType('input').props.onKeyDown(event('Escape')) })
  f.target(undefined)
  f.stat(notRegular)
  await edit(tree, '/ws/other')
  await enter(tree)
  assert.equal(f.opens.length, 0)
})

test('Escape and unmount cancel stat; a closed directory cannot commit', async t => {
  const f = fixture(t)
  const tree = await f.body()
  let pending = deferred()
  f.stat(pending.promise)
  await edit(tree, '/ws/b.txt')
  await enter(tree)
  await act(async () => { tree.root.findByType('input').props.onKeyDown(event('Escape')) })
  assert.equal(f.stats.at(-1).signal.aborted, true)
  await act(async () => { pending.resolve({ ok: true }) })
  assert.equal(f.opens.length, 0)
  pending = deferred()
  f.stat(pending.promise)
  await edit(tree, '/ws/b.txt')
  await enter(tree)
  f.controller.abort()
  await act(async () => { pending.resolve({ ok: true }) })
  assert.equal(f.opens.length, 0)
  assert.equal(tree.root.findByProps({ role: 'alert' }).children[0], 'failed')
  pending = deferred()
  f.stat(pending.promise)
  await enter(tree)
  await act(async () => { tree.unmount() })
  assert.equal(f.stats.at(-1).signal.aborted, true)
  await act(async () => { pending.resolve({ ok: true }) })
  assert.equal(f.opens.length, 0)
})
