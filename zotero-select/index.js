import { projection } from './src/projection.js'

export const name = 'zotero-select'
export const inject = ['systemPrompt', 'sessionProjections']

export const citationGuidance = `When citing a verified Zotero item, use:
**[Author, Year · Title](zotero://select/library/items/ITEMKEY)**〔Zotero〕
For group libraries, use zotero://select/groups/GROUPID/items/ITEMKEY.

Use surnames (preserve Chinese names): one author, both joined by "&",
or first author + "et al." / "等" for 3+ authors. Keep the identifying
title in its original language; omit long subtitles and venue names.
Omit missing metadata; keep labels consistent for the same item.

Replace placeholders with verified Zotero item keys and group IDs.`

export function apply(ctx) {
  ctx.sessionProjections.register(projection)
  ctx.systemPrompt.section({
    name: 'local-zotero-select',
    order: ctx.systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES') + 1,
    interpolate: false,
    text: citationGuidance,
  })
}
