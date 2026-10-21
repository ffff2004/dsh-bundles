/**
 * Preview path, browser half: turns the document preview's path row into an
 * editable path field.
 *
 * The path row is not a slot: `TextPreview` draws its own `PathLabel` and opens
 * only the controls to its right to contributions. So this half takes the same
 * seat the download control uses (`sidebar.right.tab.document.actions`) and,
 * while its editor is open, hides that sibling path row through the one marker
 * the preview publishes (`data-textpreview-path`) and claims the row's flex
 * slot with `order: -1`. Idle, the same `order: -1` seats the pencil at the
 * row's left edge, in front of the path it edits. Closing the editor removes
 * the attribute again, so the shipped path row is untouched the rest of the
 * time.
 *
 * Submitting builds the `dsh-resource://file/session/<id>/<path>` address the
 * preview tab is addressed by, asks the Host's `workspaceFiles.stat` whether
 * that path is a readable regular file, and only then asks the Sidebar to open
 * it in place of the current tab (`replaceTab`). A refused path stays in the
 * editor with a localized reason, so a typo never strands the panel on a
 * failure page that has no path row to edit.
 *
 * The tab to replace is resolved from this element at submit time
 * (`focusedTarget`), because the toolbar seat carries no tab id of its own.
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
      'placeholder': '输入工作区路径，回车预览',
      'empty': '请输入路径',
      'notFound': '文件不存在',
      'notFile': '不是常规文件',
      'failed': '无法打开该路径',
    }

    /** English dictionary, key-identical to the Chinese source of truth. */
    const en = {
      'edit': 'Edit path',
      'cancel': 'Cancel editing',
      'placeholder': 'Workspace path, Enter to preview',
      'empty': 'Enter a path',
      'notFound': 'No such file',
      'notFile': 'Not a regular file',
      'failed': 'Cannot open that path',
    }

    /** Preview root marker whose path row the open editor displaces. */
    const HIDE_ATTR = 'data-dsh-preview-path-editing'

    /** Every session file address opens with this scheme, type, and scope. */
    const FILE_PREFIX = 'dsh-resource://file/session/'

    /** Toolbar control, inline editor, and failure note; theme tokens only. */
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
.dsh-preview-path-tool:focus-visible {
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
[${HIDE_ATTR}] [data-textpreview-path] {
  display: none;
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
     * Name one stat refusal in the reader's language.
     * @param failure - the Remote failure the Host declared.
     * @param t - this plugin's translator.
     * @returns the line the editor shows.
     */
    function failureMessage(failure, t) {
      if (failure?.code === 'workspace-file/not-found') return t('notFound')
      if (failure?.code === 'workspace-file/not-regular-file') return t('notFile')
      return t('failed')
    }

    /**
     * Bind the editor to the Sidebar and Remote faces of one plugin lifetime.
     * @param ctx - the plugin context, carrying `sidebarRight` and `remote`.
     * @returns the toolbar component.
     */
    function createPathEditor(ctx) {
      /**
       * The document toolbar's path control: a pencil while idle, the path
       * editor once opened.
       * @param props - the previewed file's Host path, the Session seat, and copy.
       * @returns the control and its editor, with the row's stylesheet.
       */
      return function PathEditor({ absolutePath, sessionId, t }) {
        const [editing, setEditing] = React.useState(false)
        const [draft, setDraft] = React.useState(absolutePath)
        const [failure, setFailure] = React.useState(undefined)
        const [busy, setBusy] = React.useState(false)
        const box = React.useRef(null)
        const field = React.useRef(null)
        const probe = React.useRef(undefined)

        // A probe belongs to this editor: leaving it cancels the Host question.
        React.useEffect(() => () => { probe.current?.abort() }, [])

        // The draft follows the file the tab now shows.
        React.useEffect(() => { setDraft(absolutePath) }, [absolutePath])

        // While open, the editor takes the path row's place and focus.
        React.useEffect(() => {
          if (!editing) return undefined
          const root = box.current?.closest('[data-textpreview-state]')
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
         * Open the typed path in this tab: the Host confirms the file first,
         * then the Sidebar replaces the tab that holds this control.
         */
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
          const address = fileAddress(sessionId, path)
          const open = () => {
            try {
              const tabs = ctx.sidebarRight
              const target = box.current === null ? undefined : tabs.focusedTarget(box.current)
              const replace = target !== undefined && target.tabId !== undefined && tabs.isTargetCurrent(target)
              tabs.openResource(address, replace ? { replaceTab: target.tabId } : {})
              stop()
            } catch {
              // A wiring refusal (no Session on screen, an address no type
              // claims) is reported on the editor, never thrown into the pane.
              setFailure(t('failed'))
            }
          }
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
              if (result.ok) open()
              else setFailure(failureMessage(result.error, t))
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

        return h(
          React.Fragment,
          null,
          h('style', null, STYLE),
          editing
            ? editor
            : h('button', {
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
            )),
        )
      }
    }

    return {
      // `remote.workspaceFiles` is the Host's own file stat, the same read the
      // preview makes; `sidebarRight` opens the addressed file as a tab.
      inject: ['slots', 'locale', 'sidebarRight', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'preview-path: dictionaries')
        const PathEditor = createPathEditor(ctx)
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'preview-path',
          order: 10,
          locale: NS,
        }, PathEditor)), 'preview-path: document toolbar control')
      },
      // Pure helpers reached by `check.mjs` only; the loader ignores extra fields.
      __test: { fileAddress, failureMessage },
    }
  },
})
