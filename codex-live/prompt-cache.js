/**
 * Omit session-level cache grouping: GPT-5.6+ routes caches automatically, and
 * this deployment needs no separate cache accounting. Avoiding unnecessary
 * grouping may help cross-session reuse; it does not guarantee more cache hits.
 * Preserve transport/session identity and retention. OpenAI API guidance is not
 * a guarantee of identical behavior on the ChatGPT backend used by this route.
 * https://developers.openai.com/api/docs/guides/prompt-caching.md#prompt-cache-keys
 */
export function withoutPromptCacheKey(options) {
  return {
    ...options,
    onPayload: async (body, model) => {
      const replacement = await options?.onPayload?.(body, model)
      const payload = replacement === undefined ? body : replacement
      delete payload.prompt_cache_key
      return payload
    },
  }
}
