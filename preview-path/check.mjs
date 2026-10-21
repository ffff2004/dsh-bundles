/**
 * Self-check for the browser half: loads `client.js` the way the Web page does
 * (a module-loader registration, then a factory call), then asserts the plugin
 * surface, the address grammar, the failure copy, and the slot registration.
 *
 * The editor's rendering needs the live page; this check covers everything that
 * can be exercised without a DOM.
 *
 * Run: node check.mjs
 */
import { readFile } from 'node:fs/promises'

const failures = []
const check = (label, condition, detail) => {
  if (condition) return
  failures.push(`${label}${detail === undefined ? '' : `: ${detail}`}`)
}

/** Registration captured from `window.__ModuleLoader__.load`. */
let registration
globalThis.window = { __ModuleLoader__: { load: (row) => { registration = row } } }

/** The only module a factory may require without a browser module table. */
const react = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
}

await import('./client.js')

check('module id', registration?.id === '@local/dsh-preview-path', registration?.id)

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`client.js required an unexpected module: ${specifier}`)
})

check('service injection', Array.isArray(plugin.inject)
  && plugin.inject.includes('slots')
  && plugin.inject.includes('locale')
  && plugin.inject.includes('sidebarRight')
  && plugin.inject.includes('remote.workspaceFiles'), String(plugin.inject))

const { fileAddress, failureMessage } = plugin.__test

// Address grammar: one case per rule the copied encoder must keep in step with
// `@deepseek-ai/dsh-util-workspace-path`'s `sessionFileAddress`.
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

const say = (key) => key
check('missing file copy', failureMessage({ code: 'workspace-file/not-found' }, say) === 'notFound')
check('directory copy', failureMessage({ code: 'workspace-file/not-regular-file' }, say) === 'notFile')
check('other copy', failureMessage({ code: 'gateway/bad-request' }, say) === 'failed')
check('no failure', failureMessage(undefined, say) === 'failed')

/** Slot registrations and dictionaries the plugin body produced. */
const registrations = []
const dictionaries = {}
const ctx = {
  effect: (callback) => callback(),
  locale: { register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} } },
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
  sidebarRight: {},
  remote: { workspaceFiles: { stat: async () => ({ ok: true, value: {} }) } },
}

plugin.apply(ctx)

const [slot] = registrations
check('one slot registration', registrations.length === 1, String(registrations.length))
check('toolbar seat', slot?.options.name === 'sidebar.right.tab.document.actions', slot?.options.name)
check('own cell id', slot?.options.id === 'preview-path', slot?.options.id)
check('order before download', slot?.options.order === 10, String(slot?.options.order))
check('copy follows the active locale', slot?.options.locale === 'previewPath', slot?.options.locale)
check('component registered', typeof slot?.component === 'function')

const zhKeys = Object.keys(dictionaries.previewPath?.zh ?? {}).sort()
const enKeys = Object.keys(dictionaries.previewPath?.en ?? {}).sort()
check('dictionaries registered', zhKeys.length > 0 && enKeys.length === zhKeys.length)
check('dictionary keys match', JSON.stringify(zhKeys) === JSON.stringify(enKeys), enKeys.join(','))

// The source must stay a plain script the Web page can evaluate: no import
// statements, and the registration is the first statement.
const source = await readFile(new URL('./client.js', import.meta.url), 'utf8')
check('plain script', !/^\s*(?:import|export)\s/m.test(source))
check('registers through the module loader', /window\.__ModuleLoader__\.load\(\{/.test(source))

if (failures.length > 0) {
  console.error(`preview-path check failed:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`preview-path check passed (${registrations.length} seat, ${zhKeys.length} strings)`)
}
