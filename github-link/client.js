window.__ModuleLoader__.load({
  id: '@ffff2004-dsh-packages/github-link',
  factory(require) {
    const { createElement: h, useEffect, useId, useRef, useState } = require('react')
    const NS = 'workspaceGithubLink'
    const SLOT = 'conversation.session.header.utilities'

    async function readTargets(workspaceId, signal) {
      const query = new URLSearchParams({ workspaceId })
      const response = await fetch(`api/github-link?${query}`, { signal, cache: 'no-store' })
      if (!response.ok) return []
      const { links } = await response.json()
      return Array.isArray(links) ? links : []
    }
    const CSS = `
/* Matches the DSH session header's compact ghost Button. */
.dsh-github-link-trigger {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none;
  box-sizing: border-box; width: 28px; height: 28px; padding: 0;
  border: none; border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-secondary); background: transparent;
  text-decoration: none; cursor: pointer;
}
.dsh-github-link-trigger--menu { width: auto; padding-inline: 6px; }
@media (hover: hover) {
  .dsh-github-link-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-github-link-trigger:active,
.dsh-github-link-trigger:has(+ :popover-open) {
  background: var(--dsw-alias-interactive-bg-active);
}
.dsh-github-link-trigger:has(+ :popover-open) { color: var(--dsw-alias-label-primary); }
/* Use the DSH context menu surface and row tokens without changing link semantics. */
.dsh-github-link-list {
  position: fixed; inset: var(--github-link-top) var(--github-link-right) auto auto;
  margin: 0; padding: 4px; box-sizing: border-box;
  --github-link-width: calc(100vw - var(--github-link-right) - 8px);
  min-width: min(144px, var(--github-link-width));
  max-width: min(360px, var(--github-link-width));
  max-height: min(50dvh, calc(100dvh - var(--github-link-top) - 8px));
  overflow: auto; border: 0; border-radius: var(--dsw-radius-lg);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  box-shadow: var(--dsw-elevation-prominent);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
@supports (backdrop-filter: blur(1px)) {
  .dsh-github-link-list {
    background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1));
    backdrop-filter: var(--dsw-menu-backdrop-filter);
  }
}
.dsh-github-link-list a {
  display: block; box-sizing: border-box; min-height: 34px;
  padding: 7px 8px; border-radius: var(--dsw-radius-md);
  color: inherit; text-decoration: none; font-size: 13px; line-height: 20px;
  overflow-wrap: anywhere;
}
@media (hover: hover) {
  .dsh-github-link-list a:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-github-link-list a:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline-offset: -2px;
}
.dsh-github-link-list small { margin-inline-start: 8px; color: var(--dsw-alias-label-secondary); }
`
    const linkProps = { target: '_blank', rel: 'noopener noreferrer' }

    function GithubMark() {
      // Primer Octicons v19.21.1, mark-github-16. See THIRD-PARTY-NOTICES.md.
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z' }))
    }

    function RepositoryMenu({ targets, label, newTab }) {
      const id = useId()
      const trigger = useRef(null)
      const list = useRef(null)
      function position() {
        const { bottom, right } = trigger.current.getBoundingClientRect()
        list.current.style.setProperty('--github-link-top', `${bottom + 4}px`)
        list.current.style.setProperty('--github-link-right', `${Math.max(8, window.innerWidth - right)}px`)
      }
      useEffect(() => {
        const onResize = () => { if (list.current?.matches(':popover-open')) position() }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return h('div', null,
        h('button', { ref: trigger, className: 'dsh-github-link-trigger dsh-github-link-trigger--menu', type: 'button', popovertarget: id, onClick: position, 'aria-label': label, title: label },
          h(GithubMark), h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true },
            h('path', { d: 'm2 4 3 3 3-3', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        h('nav', { id, ref: list, className: 'dsh-github-link-list', popover: 'auto', 'aria-label': label },
          targets.map(({ url, repository, remotes }) => h('a', {
            ...linkProps, key: url, href: url, title: newTab,
            'aria-label': `${repository} (${remotes.join(', ')}; ${newTab})`, onClick: () => list.current.hidePopover(),
          }, repository, h('small', null, remotes.join(', '))))),
      )
    }

    function Repositories({ workspaceId, t }) {
      const [targets, setTargets] = useState([])
      useEffect(() => {
        const abort = new AbortController()
        readTargets(workspaceId, abort.signal).then(links => {
          if (!abort.signal.aborted) setTargets(links)
        }).catch(() => {})
        return () => abort.abort()
      }, [workspaceId])
      if (targets.length === 0) return null
      if (targets.length === 1) {
        const { repository, url } = targets[0]
        const label = `${t('open')}: ${repository} (${t('newTab')})`
        return h('a', { ...linkProps, href: url, className: 'dsh-github-link-trigger', title: label, 'aria-label': label }, h(GithubMark))
      }
      return h(RepositoryMenu, { targets, label: t('choose'), newTab: t('newTab') })
    }

    return {
      inject: ['locale', 'slots'],
      apply(ctx) {
        function GithubLink({ sessionId, useWorkspaces, t }) {
          const workspaceId = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId))?.workspaceId)
          return workspaceId ? h(Repositories, { key: workspaceId, workspaceId, t }) : null
        }
        ctx.effect(() => ctx.locale.register(NS, {
          en: { open: 'GitHub repository', choose: 'GitHub repository picker', newTab: 'Opens in a new tab' },
          zh: { open: 'GitHub 仓库', choose: 'GitHub 仓库选择', newTab: '在新标签页打开' },
        }))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.pluginCss = NS
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        })
        ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: 'workspace-github-link', order: -7, locale: NS }, GithubLink))
      },
    }
  },
})
