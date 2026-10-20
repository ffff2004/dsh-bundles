/**
 * Keep lean's common tool prefix before lean-cordis's additional tools rather
 * than interrupting it with alphabetically interleaved Cordis-only schemas.
 * This may improve cross-preset/session cache reuse if backend rendering keeps
 * that prefix: DeepSeek detects and persists common prefixes (also at fixed
 * token intervals), whereas GPT-5.6+ requires eligible cache lookup boundaries.
 * Tool ordering alone guarantees neither a cache boundary nor a cache hit.
 * https://api-docs.deepseek.com/zh-cn/guides/kv_cache/
 * https://developers.openai.com/api/docs/guides/prompt-caching.md#how-prefix-matching-works
 */
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
