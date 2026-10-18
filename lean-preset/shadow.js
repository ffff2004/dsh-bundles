/**
 * Lean-only suppression of three host prompt sections.
 *
 * `harness:identity` (`dsh-system-prompt`), `harness:source` (app boot), and
 * `app:web-surface` (the web app) are registered on the global prompt layer, so
 * no preset configuration can remove them individually: the persona row's
 * `complete` is all-or-nothing, and a preset cannot mount the prompt registry.
 * This row registers empty same-name sections in the preset's scope instead.
 * Registration views inherit ancestor layers down a scope chain, so each empty
 * entry shadows the global one for every agent that selects this preset, and
 * `renderPrompt` drops empty text.
 *
 * Shadowing is name-based, so an upstream rename would silently re-widen the
 * prompt. The `system-prompt/assemble` listener below inspects the final
 * assembly (event admission carries a descendant dispatch up to this
 * ancestor-scope listener) and throws when any of the three first-party
 * paragraphs still appears among the sections or the runtime contexts, turning
 * that drift into a failed turn instead of a quiet leak.
 */

/**
 * One suppressed section: the name to shadow, its canonical ordering slot, and
 * the first-party text whose presence means the shadow missed.
 */
const SUPPRESSED = [
  {
    name: 'harness:identity',
    order: 'HARNESS_IDENTITY',
    marker: 'You are an AI agent powered by DeepSeek Harness.',
  },
  {
    name: 'harness:source',
    order: 'HARNESS_SOURCE',
    marker: 'The runtime context names the DeepSeek Harness implementation checkout.',
  },
  {
    name: 'app:web-surface',
    order: 'WEB_SURFACE',
    marker: 'You are interacting with the user through the DeepSeek Harness Web GUI',
  },
]

/** Cordis plugin name. */
export const name = 'lean-shadow-harness-sections'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/**
 * Shadow the three sections and assert they stay suppressed.
 * @param {object} ctx - the preset's scope context, carrying `systemPrompt`.
 */
export function apply(ctx) {
  for (const { name: section, order } of SUPPRESSED) {
    ctx.effect(
      () => ctx.systemPrompt.section({ name: section, order: ctx.systemPrompt.getSectionOrder(order), text: '' }),
      `lean-shadow.section(${section})`,
    )
  }
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const result = await next()
    const leaked = [...result.sections, ...result.contexts]
      .filter(entry => entry.text.length > 0 && SUPPRESSED.some(({ marker }) => entry.text.includes(marker)))
    if (leaked.length > 0) {
      throw new Error(
        `lean preset: first-party prompt sections are no longer suppressed (${leaked.map(entry => entry.name).join(', ')}); `
        + 'upstream renamed, reworded, or moved them — update SUPPRESSED in @local/dsh-lean-preset/shadow.js',
      )
    }
    return result
  })
}
