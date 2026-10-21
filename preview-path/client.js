/**
 * Preview path, browser half: makes the document preview's path row editable
 * and adds a directory page that any path can be opened in.
 *
 * Four surfaces, one editor:
 *
 * - The document preview's toolbar (`sidebar.right.tab.document.actions`). The
 *   path row there is not a slot: `TextPreview` draws its own `PathLabel` and
 *   opens only the controls to its right. So the control hides that sibling row
 *   through the one marker the preview publishes (`data-textpreview-path`) and
 *   claims the row's flex slot with `order: -1` — idle, the pencil sits at the
 *   row's left edge, in front of the path it edits.
 * - The file tree's toolbar (`sidebar.right.tab.files.actions`), the same
 *   gesture against the tree's own path row (`data-files-path`).
 * - The directory page's own header (`preview-path-directory`), where the
 *   editor is the row rather than a displacement of one.
 * - A tab menu item for any tab addressed at a file, so a preview that never
 *   resolved its metadata (a directory, a missing path) still has a way into
 *   the directory page, where the same editor can correct the path.
 *
 * Submitting a path asks the Host's `workspaceFiles.stat` what it is: a regular
 * file opens in the document preview, replacing the tab the editor lives in; a
 * non-regular path (a directory, or a link to one) opens the directory page;
 * anything else stays in the editor with a localized reason. The directory page
 * lists through `workspaceFiles.list`, which is workspace-scoped, and follows a
 * file row into the document preview.
 *
 * Why the directory page exists instead of claiming directory addresses: a tab
 * type's `canOpen(address)` is synchronous, so no plugin can tell a directory
 * from a file at claim time. A click on a directory address therefore still
 * lands on the document preview's failure state first; the tab menu item is the
 * way from there into the directory page.
 *
 * The tab to replace is resolved from the editor element at submit time
 * (`focusedTarget`), because the toolbar seats carry no tab id of their own.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-preview-path',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace of this plugin's copy. */
    const NS = 'previewPath'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'edit': '编辑路径',
      'cancel': '取消编辑',
      'placeholder': '输入工作区路径，回车打开',
      'empty': '请输入路径',
      'notFound': '文件不存在',
      'failed': '无法打开该路径',
      'loading': '正在读取…',
      'reload': '重新载入',
      'up': '上一级目录',
      'emptyDir': '空目录',
      'truncated': '条目过多，只列出了前一部分',
      'notDirectory': '不是目录',
      'outsideWorkspace': '不在工作区内',
      'guide.title': '目录',
      'guide.description': '按路径浏览目录',
      'tab.title': '目录',
      'menu.openAsDirectory': '以目录打开',
    }

    /** English dictionary, key-identical to the Chinese source of truth. */
    const en = {
      'edit': 'Edit path',
      'cancel': 'Cancel editing',
      'placeholder': 'Workspace path, Enter to open',
      'empty': 'Enter a path',
      'notFound': 'No such file',
      'failed': 'Cannot open that path',
      'loading': 'Reading…',
      'reload': 'Reload',
      'up': 'Parent directory',
      'emptyDir': 'Empty directory',
      'truncated': 'More entries were not listed',
      'notDirectory': 'Not a directory',
      'outsideWorkspace': 'Outside the workspace',
      'guide.title': 'Directory',
      'guide.description': 'Browse a directory by path',
      'tab.title': 'Directory',
      'menu.openAsDirectory': 'Open as directory',
    }

    /** Attribute the open editor sets on the root whose path row it displaces. */
    const HIDE_ATTR = 'data-dsh-preview-path-editing'

    /** Every session file address opens with this scheme, type, and scope. */
    const FILE_PREFIX = 'dsh-resource://file/session/'

    /** Page type that lists a directory; its id is also the body and title cell key. */
    const DIRECTORY_KIND = 'preview-path-directory'
    const DIRECTORY_ID = '@local/dsh-preview-path/directory'

    /** Reads sort like names, not bytes: `file2` before `file10`, ignored case. */
    const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

    /** Toolbar control, shared editor, directory page, and menu item; theme tokens only. */
    const STYLE = `
.dsh-preview-path-tool {
  display: inline-flex;
  flex: none;
  order: -1;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 28px;
  cursor: pointer;
}
.dsh-preview-path-tool:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-preview-path-up {
  order: -2;
}
.dsh-preview-path-tool:focus-visible,
.dsh-dir-tool:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-preview-path-editor {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  order: -1;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.dsh-preview-path-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  font-family: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  outline: none;
}
.dsh-preview-path-input::placeholder {
  color: var(--dsw-alias-label-secondary);
}
.dsh-preview-path-input:focus {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-preview-path-input[aria-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-preview-path-cancel {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 4px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 24px;
  cursor: pointer;
}
.dsh-preview-path-cancel:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-preview-path-cancel:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-preview-path-failure {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  z-index: 2;
  max-width: 100%;
  padding: 4px 8px;
  overflow: hidden;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--dsw-alias-bg-overlay);
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: 6px;
}
[${HIDE_ATTR}] [data-textpreview-path],
[${HIDE_ATTR}] [data-files-path] {
  display: none;
}
.dsh-dir-root {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}
.dsh-dir-header {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  box-sizing: border-box;
  height: 38px;
  padding: 0 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-dir-field {
  display: flex;
  flex: 1 1 auto;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.dsh-dir-path {
  display: flex;
  flex: 1 1 auto;
  justify-content: flex-end;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  background: transparent;
  border: none;
  cursor: text;
}
.dsh-dir-path-text {
  flex: none;
  margin-right: auto;
}
.dsh-dir-path-dir {
  color: var(--dsw-alias-label-secondary);
}
.dsh-dir-path-name {
  color: var(--dsw-alias-label-primary);
}
.dsh-dir-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 28px;
  cursor: pointer;
}
.dsh-dir-tool:hover:not([disabled]) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-dir-tool[disabled] {
  opacity: 0.4;
  cursor: default;
}
.dsh-dir-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 4px 6px 12px;
  overflow: auto;
}
.dsh-dir-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-dir-row {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 4px 8px;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.dsh-dir-row:hover:not([disabled]) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-dir-row[disabled] {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dsh-dir-icon {
  flex: none;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dir-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-dir-note {
  margin: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-dir-note[data-error] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-path-menu {
  display: block;
  width: 100%;
  padding: 6px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.dsh-path-menu:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
`

    /**
     * Component-encode one path segment, keeping `:` literal for a drive letter.
     * Mirrors `encodeSegment` in `@deepseek-ai/dsh-util-workspace-path`; the
     * browser half cannot import that module, so the grammar lives here too.
     * @param segment - one `/`-separated segment of an id or a path.
     * @returns the segment as it appears in an address.
     */
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    /**
     * Build the address of a file read through one Session.
     * @param sessionId - the Session whose Host workspace resolves the path.
     * @param path - absolute or workspace-relative path, under either separator.
     * @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
     */
    function fileAddress(sessionId, path) {
      const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      const encoded = normalized.split('/').map(encodeSegment).join('/')
      return `${FILE_PREFIX}${encodeSegment(String(sessionId))}/${encoded}`
    }

    /**
     * Read the path back out of a `dsh-resource://file/…` address.
     * Mirrors `parseFileAddress`; a tab's content id is the only place the tab
     * menu item can learn the path a preview was addressed with.
     * @param address - a candidate address.
     * @returns the decoded path, or `undefined` for any other address.
     */
    function pathOfAddress(address) {
      const prefix = 'dsh-resource://file/'
      if (typeof address !== 'string' || !address.startsWith(prefix)) return undefined
      const parts = address.slice(prefix.length).split(/[?#]/)[0].split('/')
      try {
        if (parts[0] === 'session') {
          if (parts.length < 3) return undefined
          return parts.slice(2).map(decodeURIComponent).join('/')
        }
        if (parts[0] === 'absolute') {
          const unc = parts[1] === '' && parts.length > 2
          const segments = (unc ? parts.slice(2) : parts.slice(1)).map(decodeURIComponent)
          if (segments.length === 0 || segments[0] === '') return undefined
          if (unc) return `//${segments.join('/')}`
          return /^[A-Za-z]:$/.test(segments[0]) ? segments.join('/') : `/${segments.join('/')}`
        }
      } catch {
        // A malformed escape names no path this menu can act on.
        return undefined
      }
      return undefined
    }

    /**
     * Join one directory and one entry name.
     * @param parent - absolute directory path.
     * @param name - the entry's name.
     * @returns the entry's absolute path, under `/`.
     */
    function joinPath(parent, name) {
      const base = parent.replace(/[\\/]+$/, '')
      return base === '' ? name : `${base}/${name}`
    }

    /**
     * The directory one level up.
     * @param path - absolute path.
     * @returns the parent, or `undefined` for a root and a drive root.
     */
    function parentOf(path) {
      const trimmed = path.replace(/[\\/]+$/, '')
      const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      if (cut <= 0) return undefined
      const parent = trimmed.slice(0, cut)
      return /^[A-Za-z]:$/.test(parent) ? undefined : parent
    }

    /**
     * The directory the parent button opens.
     *
     * Listings are workspace-scoped, so the workspace root is a floor: the
     * endpoint reports the listed directory relative to that root (`''` for
     * the root itself), which is the only place this page can learn where the
     * floor is. A path whose listing failed keeps its syntactic parent, so the
     * button still offers a way back from an outside or missing path.
     *
     * @param path - the path the page is on.
     * @param listed - the listing for exactly that path, when one arrived.
     * @returns the parent path, or `undefined` when there is nothing above it.
     */
    function parentTarget(path, listed) {
      if (path === undefined || path === '') return undefined
      if (listed !== undefined && listed.path === '') return undefined
      return parentOf(path)
    }

    /**
     * Order one listing for reading: directories first, then names.
     * @param entries - the listing's entries.
     * @returns a new array, sorted.
     */
    function sortEntries(entries) {
      return [...entries].sort((left, right) => {
        const group = Number(right.type === 'directory') - Number(left.type === 'directory')
        return group !== 0 ? group : byName.compare(left.name, right.name)
      })
    }

    /**
     * Name one stat refusal in the reader's language.
     * @param failure - the Remote failure the Host declared.
     * @param t - this plugin's translator.
     * @returns the line the editor shows.
     */
    function statFailure(failure, t) {
      return failure?.code === 'workspace-file/not-found' ? t('notFound') : t('failed')
    }

    /**
     * Name one listing refusal in the reader's language.
     * @param failure - the Remote failure the Host declared.
     * @param t - this plugin's translator.
     * @returns the line the page shows.
     */
    function listFailure(failure, t) {
      switch (failure?.code) {
        case 'workspace-file/not-found': return t('notFound')
        case 'workspace-file/not-directory': return t('notDirectory')
        case 'workspace-file/outside-workspace': return t('outsideWorkspace')
        default: return t('failed')
      }
    }

    /**
     * Bind one path editor to the Sidebar and the Remote face.
     * @param ctx - the plugin context carrying `sidebarRight` and `remote`.
     * @returns the shared path field component.
     */
    function createPathField(ctx) {
      /**
       * The path control: a pencil while idle, the path editor once opened.
       *
       * A toolbar placement runs its own open: a file replaces the tab that
       * holds the control, a directory opens the directory page in its place.
       * An inline placement (the directory page's own header) is given `open`,
       * because there the file replaces the page and a directory re-roots it.
       *
       * @param props - the current path, the Session seat, copy, placement, and owners.
       * @returns the control and its editor, with the row's stylesheet.
       */
      return function PathField({ absolutePath, sessionId, t, variant, hide, open, parent }) {
        const [editing, setEditing] = React.useState(false)
        const [draft, setDraft] = React.useState(absolutePath)
        const [failure, setFailure] = React.useState(undefined)
        const [busy, setBusy] = React.useState(false)
        const box = React.useRef(null)
        const field = React.useRef(null)
        const up = React.useRef(null)
        const probe = React.useRef(undefined)

        // A probe belongs to this editor: leaving it cancels the Host question.
        React.useEffect(() => () => { probe.current?.abort() }, [])

        // The draft follows the path the surface now shows.
        React.useEffect(() => { setDraft(absolutePath) }, [absolutePath])

        // While open, the editor takes the displaced row's place and the focus.
        React.useEffect(() => {
          if (!editing) return undefined
          const root = hide === undefined ? null : box.current?.closest(hide.root)
          root?.setAttribute(HIDE_ATTR, '')
          field.current?.focus()
          field.current?.select()
          return () => { root?.removeAttribute(HIDE_ATTR) }
        }, [editing])

        const stop = () => {
          probe.current?.abort()
          probe.current = undefined
          setBusy(false)
          setEditing(false)
        }

        const start = () => {
          setFailure(undefined)
          setDraft(absolutePath)
          setEditing(true)
        }

        /**
         * Where a toolbar placement opens its result: this control's own tab.
         * @param element - the control the gesture came from.
         * @returns the placement, or nothing to let the Sidebar pick.
         */
        const placement = (element) => {
          if (variant !== 'toolbar' || element === null) return {}
          const tabs = ctx.sidebarRight
          const target = tabs.focusedTarget(element)
          return target !== undefined && target.tabId !== undefined && tabs.isTargetCurrent(target)
            ? { replaceTab: target.tabId }
            : {}
        }

        const submit = () => {
          const path = draft.trim()
          if (path === '') {
            setFailure(t('empty'))
            return
          }
          if (path === absolutePath) {
            stop()
            return
          }
          if (busy) return
          const place = placement(box.current)
          const address = fileAddress(sessionId, path)
          probe.current?.abort()
          const scope = new AbortController()
          probe.current = scope
          setBusy(true)
          setFailure(undefined)
          ctx.remote.workspaceFiles.stat(sessionId, path, scope.signal).then(
            (result) => {
              if (scope.signal.aborted) return
              probe.current = undefined
              setBusy(false)
              if (result.ok) {
                stop()
                if (open !== undefined) open.file(address)
                else ctx.sidebarRight.openResource(address, place)
                return
              }
              // A non-regular path (a directory, or a link to one) is the
              // directory page's business; that page reports anything else.
              if (result.error?.code === 'workspace-file/not-regular-file') {
                stop()
                if (open !== undefined) open.directory(path)
                else ctx.sidebarRight.openTab(DIRECTORY_KIND, { ...place, params: { path } })
                return
              }
              setFailure(statFailure(result.error, t))
            },
            () => {
              if (scope.signal.aborted) return
              probe.current = undefined
              setBusy(false)
              setFailure(t('failed'))
            },
          )
        }

        const editor = h(
          'span',
          { ref: box, className: 'dsh-preview-path-editor', 'data-preview-path-editor': '' },
          h('input', {
            ref: field,
            className: 'dsh-preview-path-input',
            type: 'text',
            value: draft,
            placeholder: t('placeholder'),
            spellCheck: false,
            autoComplete: 'off',
            'aria-label': t('edit'),
            'aria-invalid': failure === undefined ? undefined : true,
            'aria-busy': busy || undefined,
            readOnly: busy,
            onChange: (event) => {
              setDraft(event.target.value)
              if (failure !== undefined) setFailure(undefined)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                submit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                stop()
              }
            },
          }),
          h('button', {
            type: 'button',
            className: 'dsh-preview-path-cancel',
            'aria-label': t('cancel'),
            title: t('cancel'),
            onClick: stop,
          }, h(
            'svg',
            {
              viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
              strokeLinecap: 'round',
            },
            h('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }),
          )),
          failure === undefined
            ? null
            : h('span', { className: 'dsh-preview-path-failure', role: 'alert' }, failure),
        )

        const pencil = h('button', {
          type: 'button',
          className: 'dsh-preview-path-tool',
          'aria-label': t('edit'),
          title: t('edit'),
          'data-preview-path-tool': '',
          onClick: start,
        }, h(
          'svg',
          {
            viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
            strokeLinecap: 'round', strokeLinejoin: 'round',
          },
          h('path', { d: 'M2.5 13.2h11' }),
          h('path', { d: 'M9.4 3.1a1.55 1.55 0 0 1 2.2 2.2l-5.9 5.9-2.9.7.7-2.9z' }),
        ))

        if (variant === 'inline') {
          const cut = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
          const directory = cut === -1 ? '' : absolutePath.slice(0, cut + 1)
          const name = cut === -1 ? absolutePath : absolutePath.slice(cut + 1)
          return h(
            React.Fragment,
            null,
            h('style', null, STYLE),
            h(
              'span',
              { className: 'dsh-dir-field' },
              editing
                ? editor
                : h(
                  React.Fragment,
                  null,
                  h('button', {
                    type: 'button',
                    className: 'dsh-dir-path',
                    title: absolutePath,
                    'data-preview-path-label': '',
                    onClick: start,
                  }, h('span', { className: 'dsh-dir-path-text' },
                    h('span', { className: 'dsh-dir-path-dir' }, directory),
                    h('span', { className: 'dsh-dir-path-name' }, name))),
                  pencil,
                ),
            ),
          )
        }

        const parentPath = parentOf(absolutePath)
        const parentButton = parent === true && h('button', {
          ref: up,
          type: 'button',
          className: 'dsh-dir-tool dsh-preview-path-up',
          'data-preview-path-parent': '',
          'aria-label': t('up'),
          title: t('up'),
          disabled: parentPath === undefined,
          onClick: () => {
            if (parentPath === undefined) return
            try {
              ctx.sidebarRight.openTab(DIRECTORY_KIND, { ...placement(up.current), params: { path: parentPath } })
            } catch {
              // A wiring refusal (no on-screen Session) leaves the row alone.
            }
          },
        }, h(UpGlyph))

        return h(
          React.Fragment,
          null,
          h('style', null, STYLE),
          editing
            ? editor
            : h(React.Fragment, null, parentButton, pencil),
        )
      }
    }

    /**
     * The directory page body: list the addressed directory, follow its rows.
     * @param PathField - the shared editor.
     * @returns the page body component.
     */
    function createDirectoryBody(PathField) {
      /**
       * One directory, listed by path, with its own editable path row.
       * @param props - the tab seat, the Session seat, copy, and the listing call.
       * @returns the page.
       */
      return function DirectoryBody({ useTabInfo, sessionId, useSessions, t, list }) {
        const { tab } = useTabInfo()
        const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
        const requested = tab.navigation.params?.path
        const [path, setPath] = React.useState(requested)
        const [nonce, setNonce] = React.useState(0)
        const [state, setState] = React.useState({ kind: 'loading' })

        // A page opened without a path starts at the Session's workspace root.
        React.useEffect(() => {
          if (path === undefined && cwd !== undefined) setPath(cwd)
        }, [path, cwd])

        // A navigation that carries a path re-roots the same page.
        React.useEffect(() => {
          if (requested !== undefined) setPath(requested)
        }, [tab.navigation.revision])

        React.useEffect(() => {
          if (path === undefined) return undefined
          const scope = new AbortController()
          setState({ for: path, kind: 'loading' })
          list(path, scope.signal).then(
            (result) => {
              if (scope.signal.aborted) return
              setState(result.ok
                ? { for: path, kind: 'ready', value: result.value }
                : { for: path, kind: 'failed', failure: result.error })
            },
            () => {
              if (!scope.signal.aborted) setState({ for: path, kind: 'failed', failure: undefined })
            },
          )
          return () => { scope.abort() }
        }, [path, nonce, sessionId])

        React.useEffect(() => tab.actions.bindCommands({ refresh: () => { setNonce(value => value + 1) } }), [tab.actions])

        const reload = () => { setNonce(value => value + 1) }
        // A state left over from another path is stale: the effect below is
        // about to replace it, so the page reads as loading until it does.
        const current = state.for === path ? state : undefined
        const parent = parentTarget(path, current?.kind === 'ready' ? current.value : undefined)
        const openFile = (target) => { tab.actions.openResource(fileAddress(sessionId, target)) }

        const row = (entry) => {
          const target = path === undefined ? entry.name : joinPath(path, entry.name)
          const kind = entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : 'other'
          return h('li', { key: entry.name, className: 'dsh-dir-item' },
            h('button', {
              type: 'button',
              className: 'dsh-dir-row',
              'data-preview-path-entry': kind,
              'data-preview-path-name': entry.name,
              disabled: kind === 'other',
              onClick: kind === 'directory' ? () => { setPath(target) } : kind === 'file' ? () => { openFile(target) } : undefined,
            },
              h(FileGlyph, { directory: kind === 'directory' }),
              h('span', { className: 'dsh-dir-name' }, entry.name)))
        }

        const content = () => {
          if (current === undefined || current.kind === 'loading') {
            return h('p', { className: 'dsh-dir-note' }, t('loading'))
          }
          if (current.kind === 'failed') {
            return h('p', { className: 'dsh-dir-note', 'data-error': '' }, listFailure(current.failure, t))
          }
          const entries = sortEntries(current.value.entries)
          return [
            entries.length === 0
              ? h('p', { key: 'empty', className: 'dsh-dir-note' }, t('emptyDir'))
              : h('ul', { key: 'list', className: 'dsh-dir-list' }, entries.map(row)),
            current.value.truncated
              ? h('p', { key: 'cut', className: 'dsh-dir-note' }, t('truncated'))
              : null,
          ]
        }

        return h(
          'div',
          {
            className: 'dsh-dir-root',
            'data-preview-path-directory': '',
            'data-preview-path-root': path ?? '',
          },
          h(
            'div',
            { className: 'dsh-dir-header' },
            h('button', {
              type: 'button',
              className: 'dsh-dir-tool',
              'data-preview-path-up': '',
              'aria-label': t('up'),
              title: t('up'),
              disabled: parent === undefined,
              onClick: () => { if (parent !== undefined) setPath(parent) },
            }, h(UpGlyph)),
            h(PathField, {
              absolutePath: path ?? '',
              sessionId,
              t,
              variant: 'inline',
              open: {
                file: (address) => { tab.actions.openResource(address, { replaceTab: tab.id }) },
                directory: setPath,
              },
            }),
            h('button', {
              type: 'button',
              className: 'dsh-dir-tool',
              'data-preview-path-reload': '',
              'aria-label': t('reload'),
              title: t('reload'),
              onClick: reload,
            }, h(
              'svg',
              {
                viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
                fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
                strokeLinecap: 'round', strokeLinejoin: 'round',
              },
              h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
              h('path', { d: 'M13 2.6V5.4h-2.8' }),
            )),
          ),
          h('div', { className: 'dsh-dir-body', 'data-preview-path-body': '' }, content()),
        )
      }
    }

    /**
     * The parent-directory glyph, shared by the preview toolbar and the
     * directory page's own header.
     * @returns the icon.
     */
    function UpGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
        h('path', { d: 'M8 12.5V4' }),
        h('path', { d: 'M4.5 7.5 8 4l3.5 3.5' }),
      )
    }

    /**
     * One directory or file glyph for a listing row.
     * @param props - whether this row is a directory.
     * @returns the icon.
     */
    function FileGlyph({ directory }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true, className: 'dsh-dir-icon',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
        directory
          ? [h('path', { key: 'a', d: 'M2 4.3h4l1.3 1.6H14v6.8H2z' })]
          : [h('path', { key: 'a', d: 'M4 2.6h5l3 3v7.8H4z' }), h('path', { key: 'b', d: 'M9 2.6v3h3' })],
      )
    }

    /**
     * The guide capsule's glyph: a folder.
     * @param props - square size and layout class from the guide.
     * @returns the icon.
     */
    function DirectoryGlyph({ size = 16, className }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, className,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
        h('path', { d: 'M2 4.3h4l1.3 1.6H14v6.8H2z' }),
      )
    }

    /**
     * The directory type's registry definition: a page, no address claim.
     * @param t - namespace-bound translate, read fresh on every label call.
     * @returns the definition to register.
     */
    function directoryDefinition(t) {
      return {
        id: DIRECTORY_ID,
        kind: DIRECTORY_KIND,
        title: () => t('tab.title'),
        guide: [{
          id: 'directory',
          order: 40,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: DirectoryGlyph,
        }],
      }
    }

    /**
     * The tab chip: the type's folder and the title captured at open time.
     * @param props - the tab information hook.
     * @returns the chip contents.
     */
    function DirectoryTitle({ useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null, h(DirectoryGlyph), tab.title)
    }

    /**
     * Bind the tab menu item to the Sidebar.
     * @param ctx - the plugin context carrying `sidebarRight`.
     * @returns the menu item component.
     */
    function createOpenAsDirectory(ctx) {
      /**
       * "Open as directory" for any tab addressed at a file, including a
       * preview whose metadata never resolved (a directory, a missing path).
       * @param props - the menu's tab record, its dismiss hook, and copy.
       * @returns the item, or nothing for a tab that names no file path.
       */
      return function OpenAsDirectory({ tab, dismiss, t }) {
        const path = pathOfAddress(tab.contentId)
        if (path === undefined) return null
        return h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'dsh-path-menu',
          'data-preview-path-open-directory': '',
          onClick: () => {
            dismiss()
            try {
              ctx.sidebarRight.openTab(DIRECTORY_KIND, { params: { path }, replaceTab: tab.id })
            } catch {
              // A wiring refusal (no on-screen Session) leaves the menu closed.
            }
          },
        }, t('menu.openAsDirectory'))
      }
    }

    return {
      // `remote.workspaceFiles` is the Host's own file stat and listing, the
      // same reads the preview and the file tree make; `sidebarRight` opens the
      // addressed file or directory as a tab.
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'preview-path: dictionaries')
        const t = ctx.locale.bind(NS)
        const PathField = createPathField(ctx)
        const DirectoryBody = createDirectoryBody(PathField)
        const OpenAsDirectory = createOpenAsDirectory(ctx)

        // The directory page: a page, so it claims no address; the tab menu
        // item, the file tree's control, and a directory in the editor open it.
        ctx.effect(() => ctx.sidebarRightTabs.register(directoryDefinition(t)), 'preview-path: directory type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: DIRECTORY_ID,
          locale: NS,
          inject: (sessionId) => ({
            list: (path, signal) => ctx.remote.workspaceFiles.list(sessionId, path, signal),
          }),
        }, DirectoryBody)), 'preview-path: directory body')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: DIRECTORY_ID,
        }, DirectoryTitle)), 'preview-path: directory title')

        // The document preview's path row.
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'preview-path',
          order: 10,
          locale: NS,
        }, (props) => h(PathField, { ...props, variant: 'toolbar', parent: true, hide: { root: '[data-textpreview-state]' } }))), 'preview-path: preview toolbar')

        // The file tree's path row.
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.files.actions',
          id: 'preview-path',
          order: 10,
          locale: NS,
        }, (props) => h(PathField, { ...props, variant: 'toolbar', hide: { root: '[data-files-state]' } }))), 'preview-path: files toolbar')

        // Any tab addressed at a file: the way out of a failed preview.
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
          name: 'sidebar.right.tab.menu.item',
          id: 'preview-path',
          order: 10,
          locale: NS,
        }, OpenAsDirectory)), 'preview-path: tab menu')
      },
      // Pure helpers reached by `check.mjs` only; the loader ignores extra fields.
      __test: { fileAddress, pathOfAddress, joinPath, parentOf, parentTarget, sortEntries, statFailure, listFailure },
    }
  },
})
