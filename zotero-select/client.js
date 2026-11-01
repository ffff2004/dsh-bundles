;(function () {
  window.__ModuleLoader__.load({
    id: '@local/dsh-zotero-select',
    factory(require) {
      const React = require('react')
      const h = React.createElement
      const NS = 'localZoteroSelect'
      const KEY = 'localZoteroSelect'
      const dictionaries = {
        en: {
          literature: 'Zotero references ({count})',
          select: 'Select in Zotero',
        },
        zh: {
          literature: 'Zotero 文献（{count}）',
          select: '在 Zotero 中选中',
        },
      }
      const css = `
.dsh-zotero-select { color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsh-zotero-select summary { cursor: pointer; width: fit-content; color: var(--dsw-alias-label-secondary); padding: 4px 0; }
.dsh-zotero-select summary:hover { color: var(--dsw-alias-label-primary); }
.dsh-zotero-select summary:focus-visible, .dsh-zotero-select a:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; border-radius: 4px; }
.dsh-zotero-select ol { margin: 8px 0; padding-left: 24px; }
.dsh-zotero-select li { margin: 6px 0; overflow-wrap: anywhere; }
.dsh-zotero-select a { color: var(--dsw-alias-brand-primary); text-decoration: underline; text-underline-offset: 2px; }
`
      function equalLinks(left, right) {
        if (left === right) return true
        return !!left && !!right && left.length === right.length && left.every((link, i) =>
          link.uri === right[i].uri && link.title === right[i].title && link.itemKey === right[i].itemKey)
      }
      // Defense in depth: never put an arbitrary wire string into an anchor.
      function safeUri(uri) {
        return typeof uri === 'string' && /^zotero:\/\/select\/(?:library\/items\/[A-Z0-9]{8}|groups\/[1-9][0-9]*\/items\/[A-Z0-9]{8})$/.test(uri)
          && !/[\r\n]/.test(uri)
      }
      function ZoteroReferences(props) {
        const messageId = props.useChat(chat => {
          const closing = chat.timeline.turns.get(props.turn.turn)?.data.get('turn-tail')?.closing
          return closing?.status === 'settled' ? closing.finalNode.messageId : undefined
        })
        const links = props.useProjection(KEY, view =>
          messageId === undefined || !view || !Object.hasOwn(view, messageId) ? undefined : view[messageId], equalLinks)
        if (!links?.length) return null
        const validLinks = links.filter(link => safeUri(link.uri))
        if (validLinks.length === 0) return null
        return h('details', { className: 'dsh-zotero-select', key: messageId },
          h('style', null, css),
          h('summary', null, props.t('literature', { count: validLinks.length })),
          h('ol', null, validLinks.map(link => h('li', { key: link.uri },
            h('a', { href: link.uri, title: props.t('select') }, link.title)))))
      }
      return {
        inject: ['slots', 'locale'],
        apply(ctx) {
          ctx.locale.register(NS, dictionaries)
          ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
            name: 'conversation.chat.turnTail', id: 'local-zotero-select', order: 30, locale: NS,
          }, ZoteroReferences))
        },
      }
    },
  })
})()
