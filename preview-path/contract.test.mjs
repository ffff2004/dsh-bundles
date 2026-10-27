/**
 * Behavior tests for the browser half: loads `client.js` the way the Web page does
 * (a module-loader registration, then a factory call), then asserts the plugin
 * surface, the address grammar, the path helpers, the failure copy, the tab
 * type, the tab-menu item's behaviour, and every slot registration.
 *
 * The editor's rendering needs the live page; this check covers everything that
 * can be exercised without a DOM.
 *
 * Run: node --test
 */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'

// Keep the original check aggregation: every label in a group is evaluated.
function checkGroup(t, name, run) {
  return t.test(name, async t => {
    const failures = []
    let count = 0
    const check = (label, condition, detail) => {
      count++
      if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${detail}`}`)
    }
    await run(check)
    assert.deepEqual(failures, [], name)
    t.diagnostic(`${count} preserved check labels`)
  })
}

test('preview path client contract', async t => {
  /** Registration captured from `window.__ModuleLoader__.load`. */
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), previousWindow)
  })
  let registration
  globalThis.window = { __ModuleLoader__: { load: (row) => { registration = row } } }

  /** Elements `createElement` builds, enough to inspect what a component returns. */
  const element = (type, props, ...children) => ({ type, props: { ...props, children } })

  /** The only module a factory may require without a browser module table. */
  const react = {
    createElement: element,
    Fragment: Symbol('Fragment'),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }

  await import('./client.js')

  let plugin

  await checkGroup(t, 'module registration and service injection', async check => {
    check('module id', registration?.id === '@local/dsh-preview-path', registration?.id)

    plugin = registration.factory((specifier) => {
      if (specifier === 'react') return react
      throw new Error(`client.js required an unexpected module: ${specifier}`)
    })

    check('service injection', Array.isArray(plugin.inject)
      && ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']
        .every(key => plugin.inject.includes(key)), String(plugin.inject))
  })

  const {
    fileAddress, pathOfAddress, joinPath, parentOf, parentTarget, sortEntries, statFailure, listFailure,
  } = plugin.__test
  const say = (key) => key

  // Address grammar: one case per rule the copied encoder must keep in step with
  // `@deepseek-ai/dsh-util-workspace-path`'s `sessionFileAddress`.
  await checkGroup(t, 'forward address grammar', async check => {
    check('relative path', fileAddress('session-1', 'src/a.ts')
      === 'dsh-resource://file/session/session-1/src/a.ts', fileAddress('session-1', 'src/a.ts'))
    check('absolute path keeps its leading slash', fileAddress('session-1', '/etc/hosts')
      === 'dsh-resource://file/session/session-1//etc/hosts', fileAddress('session-1', '/etc/hosts'))
    check('leading ./ is dropped', fileAddress('s', './src/a.ts')
      === 'dsh-resource://file/session/s/src/a.ts', fileAddress('s', './src/a.ts'))
    check('backslashes are separators', fileAddress('s', 'C:\\notes\\a b.md')
      === 'dsh-resource://file/session/s/C:/notes/a%20b.md', fileAddress('s', 'C:\\notes\\a b.md'))
    check('reserved characters are encoded', fileAddress('s', 'a#b?.txt')
      === 'dsh-resource://file/session/s/a%23b%3F.txt', fileAddress('s', 'a#b?.txt'))
    check('non-ascii is encoded', fileAddress('s', '报告.md')
      === 'dsh-resource://file/session/s/%E6%8A%A5%E5%91%8A.md', fileAddress('s', '报告.md'))
    check('session id is encoded', fileAddress('s 1', 'a')
      === 'dsh-resource://file/session/s%201/a', fileAddress('s 1', 'a'))
  })

  // The reverse read the tab menu item runs over a tab's content id.
  await checkGroup(t, 'reverse address grammar', async check => {
    check('path of a session address', pathOfAddress('dsh-resource://file/session/s1/src/a%20b.md') === 'src/a b.md',
      pathOfAddress('dsh-resource://file/session/s1/src/a%20b.md'))
    check('path of an absolute address', pathOfAddress('dsh-resource://file/absolute/home/u/x.txt') === '/home/u/x.txt',
      pathOfAddress('dsh-resource://file/absolute/home/u/x.txt'))
    check('path of a drive address', pathOfAddress('dsh-resource://file/absolute/C:/x/y.txt') === 'C:/x/y.txt',
      pathOfAddress('dsh-resource://file/absolute/C:/x/y.txt'))
    check('path round trip', pathOfAddress(fileAddress('s', 'C:\\notes\\a b.md')) === 'C:/notes/a b.md',
      pathOfAddress(fileAddress('s', 'C:\\notes\\a b.md')))
    check('address without a path', pathOfAddress('dsh-resource://file/session/s1') === undefined)
    check('foreign address', pathOfAddress('sidebar://guide') === undefined)
    check('malformed escape', pathOfAddress('dsh-resource://file/session/s1/%E0%A4%A') === undefined)
  })

  await checkGroup(t, 'join and parent helpers', async check => {
    check('join', joinPath('/a/b', 'c') === '/a/b/c', joinPath('/a/b', 'c'))
    check('join with trailing separator', joinPath('/a/b/', 'c') === '/a/b/c', joinPath('/a/b/', 'c'))
    check('join at root', joinPath('', 'c') === 'c', joinPath('', 'c'))
    check('parent', parentOf('/a/b/c') === '/a/b', parentOf('/a/b/c'))
    check('parent of a trailing separator', parentOf('/a/b/') === '/a', parentOf('/a/b/'))
    check('no parent at root', parentOf('/a') === undefined, parentOf('/a'))
    check('no parent at a drive root', parentOf('C:/x') === undefined, parentOf('C:/x'))
  })

  // The parent button stops at the workspace root, which only a listing reveals:
  // its `path` is relative to that root and empty for the root itself.
  await checkGroup(t, 'workspace parent floor and listing order', async check => {
    check('parent of a listed directory', parentTarget('/ws/a/b', { path: 'a/b' }) === '/ws/a',
      parentTarget('/ws/a/b', { path: 'a/b' }))
    // A one-segment root cannot tell "path exhausted" from "listing-derived
    // workspace root": only a multi-segment root fails when the floor rule goes.
    check('workspace root has no parent', parentTarget('/repo/ws', { path: '' }) === undefined,
      parentTarget('/repo/ws', { path: '' }))
    check('parent of an unlisted path', parentTarget('/ws/a', undefined) === '/ws', parentTarget('/ws/a', undefined))
    check('no parent for an empty path', parentTarget('', undefined) === undefined)

    const sorted = sortEntries([
      { name: 'b', type: 'file' },
      { name: 'a', type: 'directory' },
      { name: 'file10', type: 'file' },
      { name: 'file2', type: 'file' },
    ])
    check('listing order', sorted.map(entry => entry.name).join(',') === 'a,b,file2,file10', sorted.map(entry => entry.name).join(','))
  })

  await checkGroup(t, 'localized failure copy', async check => {
    check('missing stat copy', statFailure({ code: 'workspace-file/not-found' }, say) === 'notFound')
    check('other stat copy', statFailure({ code: 'gateway/bad-request' }, say) === 'failed')
    check('missing listing copy', listFailure({ code: 'workspace-file/not-found' }, say) === 'notFound')
    check('not a directory copy', listFailure({ code: 'workspace-file/not-directory' }, say) === 'notDirectory')
    check('outside workspace copy', listFailure({ code: 'workspace-file/outside-workspace' }, say) === 'outsideWorkspace')
    check('other listing copy', listFailure(undefined, say) === 'failed')
  })

  /** Slot registrations, tab types, and dictionaries the plugin body produced. */
  const registrations = []
  const types = []
  const dictionaries = {}
  const tabs = []
  const ctx = {
    effect: (callback) => callback(),
    locale: { register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} }, bind: () => say },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    sidebarRightTabs: { register: (definition) => { types.push(definition); return () => {} } },
    sidebarRight: {
      openTab: (kind, options) => { tabs.push({ kind, options }) },
      focusedTarget: () => ({ tabId: 'toolbar-tab' }),
      isTargetCurrent: () => true,
    },
    remote: {
      workspaceFiles: {
        stat: async () => ({ ok: true, value: {} }),
        list: async () => ({ ok: true, value: { path: '', entries: [], truncated: false } }),
      },
    },
  }

  plugin.apply(ctx)

  await checkGroup(t, 'tab type slots locale bindings and remote listing', async check => {
    check('one tab type', types.length === 1, String(types.length))
    const type = types[0]
    check('directory kind', type?.kind === 'preview-path-directory', type?.kind)
    check('directory pages allow multiple instances', type?.multiple === true)
    check('page claims no address', type?.patterns === undefined, String(type?.patterns))
    check('tab title thunk', type?.title('sidebar://x') === 'tab.title', type?.title('sidebar://x'))
    check('guide entry', type?.guide?.length === 1 && type.guide[0].title() === 'guide.title')

    const names = registrations.map(row => row.options.name).sort().join(',')
    check('seats', names === [
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
      'sidebar.right.tab.document.actions',
      'sidebar.right.tab.files.actions',
      'sidebar.right.tab.menu.item',
    ].sort().join(','), names)

    const toolbar = registrations.filter(row => row.options.name === 'sidebar.right.tab.document.actions'
      || row.options.name === 'sidebar.right.tab.files.actions')
    check('own cell id', toolbar.every(row => row.options.id === 'preview-path'))
    check('order before download', toolbar.every(row => row.options.order === 10))
    const needingCopy = registrations.filter(row => row.options.name !== 'sidebar.right.pane.tab.title')
    check('copy follows the active locale', needingCopy.every(row => row.options.locale === 'previewPath'),
      needingCopy.map(row => `${row.options.name}:${row.options.locale}`).join(','))

    const body = registrations.find(row => row.options.name === 'sidebar.right.pane.tab')
    check('body keyed by the type id', body?.options.key === '@local/dsh-preview-path/directory', body?.options.key)
    check('body component', typeof body?.component === 'function')
    const injected = body.options.inject('session-1')
    check('body lists through the Remote', typeof injected.list === 'function')
    await injected.list('src', undefined).then((result) => {
      check('listing result rides through', result.ok === true)
    })
  })

  await checkGroup(t, 'tab menu behavior', async check => {
    const menuRow = registrations.find(row => row.options.name === 'sidebar.right.tab.menu.item')
    let dismissed = false
    const node = menuRow.component({
      tab: { id: 'tab-1', contentId: 'dsh-resource://file/session/s1/src/a%20b.md' },
      dismiss: () => { dismissed = true },
      t: say,
    })
    check('menu item renders a button', node?.type === 'button', node?.type)
    check('menu item marks itself', node?.props['data-preview-path-open-directory'] === '')
    check('menu item is a menu item', node?.props.role === 'menuitem')
    node.props.onClick()
    check('menu dismisses itself', dismissed)
    check('menu opens the directory page', tabs.length === 1
      && tabs[0].kind === 'preview-path-directory'
      && tabs[0].options.params.path === 'src/a b.md'
      && tabs[0].options.replaceTab === 'tab-1'
      && tabs[0].options.revealIfOpened === false, JSON.stringify(tabs))
    check('menu hidden off a file address', menuRow.component({
      tab: { id: 'tab-2', contentId: 'sidebar://guide' }, dismiss: () => {}, t: say,
    }) === null)
  })

  // The preview toolbar's parent button: that seat asks for one, and it opens
  // the directory page at the file's own directory.
  await checkGroup(t, 'toolbar parent navigation', async check => {
    const previewRow = registrations.find(row => row.options.name === 'sidebar.right.tab.document.actions')
    const renderToolbar = (row, absolutePath) => {
      const fieldElement = row.component({ absolutePath, sessionId: 's1', t: say })
      const toolbar = fieldElement.type(fieldElement.props)
      const button = toolbar.props.children[1].props.children[0]
      if (button) button.props.ref.current = {}
      return button
    }
    const upButton = renderToolbar(previewRow, '/repo/src/deep/file.ts')
    check('parent button rendered', upButton?.props?.['data-preview-path-parent'] === '', String(upButton?.type))
    tabs.length = 0
    upButton.props.onClick()
    check('parent opens the directory page', tabs.length === 1
      && tabs[0].kind === 'preview-path-directory'
      && tabs[0].options.params.path === '/repo/src/deep'
      && tabs[0].options.replaceTab === 'toolbar-tab'
      && tabs[0].options.revealIfOpened === false, JSON.stringify(tabs))
    check('parent disabled at a filesystem root', renderToolbar(previewRow, '/file.ts').props.disabled === true)

    const filesRow = registrations.find(row => row.options.name === 'sidebar.right.tab.files.actions')
    const filesButton = renderToolbar(filesRow, '/repo')
    check('no parent button on the file tree', filesButton?.props?.['data-preview-path-parent'] === undefined)
  })

  await checkGroup(t, 'dictionary registration and key parity', async check => {
    check('dictionaries registered', Object.keys(dictionaries.previewPath ?? {}).length === 2)
    const zhKeys = Object.keys(dictionaries.previewPath?.zh ?? {}).sort()
    const enKeys = Object.keys(dictionaries.previewPath?.en ?? {}).sort()
    check('dictionary keys match', JSON.stringify(zhKeys) === JSON.stringify(enKeys), enKeys.join(','))
  })

  // The source must stay a plain script the Web page can evaluate: no import or
  // export statements, and the registration goes through the module loader.
  await checkGroup(t, 'plain script module-loader format', async check => {
    const source = await readFile(new URL('./client.js', import.meta.url), 'utf8')
    check('plain script', !/^\s*(?:import|export)\s/m.test(source))
    check('registers through the module loader', /window\.__ModuleLoader__\.load\(\{/.test(source))
  })
})
