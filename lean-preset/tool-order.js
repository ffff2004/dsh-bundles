/** Keep lean's common tool prefix before lean-cordis's additional tools. */
export const name = 'lean-cordis-tool-order'
export const inject = ['systemPrompt']

const EXTRA_TOOLS = new Set([
  'cordis_inspect_list',
  'cordis_inspect_query',
  'plugin_manager',
  'plugin_market',
])

export function apply(ctx) {
  // Preset ownership makes dispatch scope-filtered; do not register on the Host.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    const common = []
    const extra = []
    for (const tool of assembly.tools) {
      (EXTRA_TOOLS.has(tool.name) ? extra : common).push(tool)
    }
    return { ...assembly, tools: [...common, ...extra] }
  })
}
