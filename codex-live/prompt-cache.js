/** Omit the body cache key without changing transport/session identity or retention. */
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
