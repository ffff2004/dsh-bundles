/**
 * Preview download, browser half: a download control in the document-preview
 * toolbar that hands the previewed file to the browser's own download manager.
 *
 * The control is a `sidebar.right.tab.document.actions` contribution, so it
 * renders beside the preview's own viewer, wrap, auto-refresh, and reload
 * controls for every file type this tab can show. The owner prop `absolutePath`
 * names the file in its execution world and the session-scoped `sessionId`
 * names the Session whose file scope must resolve it; both travel to the Host
 * route as query parameters.
 *
 * A `HEAD` preflight runs before an ordinary click starts the download, so a refusal this page
 * can see — an unknown Session, a path that is not a readable regular file —
 * reports on the control instead of silently producing an empty save. The
 * download itself is an ordinary same-origin navigation the browser resolves
 * against the document's base, which is what gives it the native progress,
 * save dialog, and "save link as" behavior. The control is a real anchor;
 * context-menu and modified-click actions follow its URL without the preflight.
 *
 * Styling copies the preview toolbar's own control geometry and reads theme
 * tokens only; no Harness Client package is loaded as a module.
 */

/** How long a failed gesture stays announced on the control. */
const FAILED_HOLD_MS = 4000

/** Locale namespace of this plugin's copy. */
const NS = 'previewDownload'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'download': '下载',
  'preparing': '正在准备下载…',
  'failed': '下载失败',
}

/** English dictionary, key-identical to the Chinese source of truth. */
const en = {
  'download': 'Download',
  'preparing': 'Preparing download…',
  'failed': 'Download failed',
}

/**
 * Document-relative route the Host half registers. This copy must stay in step
 * with `ROUTE_PATH` in the package's `index.js`: the two halves are separate
 * artifacts sharing no module.
 */
const ROUTE_URL = 'api/preview-download'

/** Toolbar control geometry and states, matching the preview's own tools. */
const STYLE = `
.dsh-preview-download-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  text-decoration: none;
  background: transparent;
  border: none;
  border-radius: 28px;
  cursor: pointer;
}
.dsh-preview-download-tool:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-preview-download-tool:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-preview-download-tool[data-state='busy'] {
  opacity: 0.6;
  cursor: progress;
}
.dsh-preview-download-tool[data-state='error'] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-preview-download-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
`

/**
 * Name the saved file after the path the Host resolved.
 * @param absolutePath - absolute path in the file's execution world.
 * @returns the last path segment, under either separator.
 */
function basename(absolutePath) {
  const cut = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  return cut === -1 ? absolutePath : absolutePath.slice(cut + 1)
}

/**
 * Confirm the Host will serve this file before the browser navigation starts.
 * @param url - document-relative download route with its query.
 * @returns after the Host answered that the file is served.
 */
async function preflight(url) {
  const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
  if (!response.ok) throw new Error(`preview-download: HTTP ${response.status}`)
}

/**
 * Hand one Host route to the browser download manager.
 * @param url - document-relative download route with its query.
 * @param filename - name the browser saves under.
 */
function save(url, filename) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

window.__ModuleLoader__.load({
  id: '@local/dsh-preview-download',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * The preview toolbar's download control.
     * @param props - the slot's owner path, the Session standard seat, and localized copy.
     * @returns the control and its failure announcement.
     */
    function DownloadAction(props) {
      const { absolutePath, sessionId, t } = props
      const [phase, setPhase] = React.useState('idle')
      const hold = React.useRef(0)
      React.useEffect(() => () => { window.clearTimeout(hold.current) }, [])
      const url = `${ROUTE_URL}?${new URLSearchParams({ sessionId: String(sessionId), path: absolutePath })}`
      const start = event => {
        // Preserve native link actions; only a plain click uses the preflight.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (phase === 'preparing') return
        window.clearTimeout(hold.current)
        setPhase('preparing')
        void preflight(url).then(
          () => {
            save(url, basename(absolutePath))
            setPhase('idle')
          },
          () => {
            setPhase('failed')
            hold.current = window.setTimeout(() => { setPhase('idle') }, FAILED_HOLD_MS)
          },
        )
      }
      const state = phase === 'preparing' ? 'busy' : phase === 'failed' ? 'error' : undefined
      return h(
        React.Fragment,
        null,
        h('style', null, STYLE),
        h('a', {
          href: url,
          download: basename(absolutePath),
          className: 'dsh-preview-download-tool',
          'data-state': state,
          'data-preview-download': phase,
          'aria-busy': phase === 'preparing' ? true : undefined,
          'aria-label': t('download'),
          title: phase === 'failed' ? t('failed') : phase === 'preparing' ? t('preparing') : t('download'),
          onClick: start,
        }, h(
          'svg',
          {
            viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
            strokeLinecap: 'round', strokeLinejoin: 'round',
          },
          h('path', { d: 'M8 2.5v8' }),
          h('path', { d: 'M4.75 7.25 8 10.5l3.25-3.25' }),
          h('path', { d: 'M3 13.5h10' }),
        )),
        h('span', {
          className: 'dsh-preview-download-status',
          role: 'status',
          'aria-live': 'polite',
        }, phase === 'failed' ? t('failed') : ''),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'preview-download: dictionaries')
        ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'preview-download',
          order: 20,
          locale: NS,
        }, DownloadAction))
      },
    }
  },
})
